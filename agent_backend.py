"""User-configured model access. Keys never enter scene/workflow responses."""
import asyncio
import base64
import ctypes
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web
import folder_paths

PRESETS = [
    {"id": "openai", "label": "OpenAI", "base_url": "https://api.openai.com/v1"},
    {"id": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com"},
    {"id": "qwen-cn", "label": "Qwen · 北京 / Beijing", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
    {"id": "qwen-intl", "label": "Qwen · 新加坡 / Singapore", "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"},
    {"id": "qwen-us", "label": "Qwen · 美国 / US", "base_url": "https://dashscope-us.aliyuncs.com/compatible-mode/v1"},
    {"id": "qwen-hk", "label": "Qwen · 香港 / Hong Kong", "base_url": "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"},
    {"id": "custom", "label": "自定义 / OpenAI-compatible", "base_url": ""},
]
MAX_BODY = 2 * 1024 * 1024


class AgentError(ValueError):
    pass


class DataBlob(ctypes.Structure):
    _fields_ = [("size", ctypes.c_ulong), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def protect_key(value, decrypt=False):
    if os.name != "nt":
        return value
    raw = base64.b64decode(value) if decrypt else value.encode("utf-8")
    buffer = ctypes.create_string_buffer(raw)
    source = DataBlob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = DataBlob()
    method = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not method(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise AgentError("Cannot access the locally protected API key. Please enter it again.")
    try:
        result = ctypes.string_at(target.data, target.size)
        return result.decode("utf-8") if decrypt else base64.b64encode(result).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


def config_path(request):
    token = request.headers.get("X-Topview-Agent-Session", "")
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise AgentError("Missing browser configuration token. Reopen Agent settings.")
    origin = request.headers.get("Origin")
    if origin and urlsplit(origin).netloc != request.host:
        raise AgentError("Cross-origin Agent requests are not allowed.")
    root = Path(folder_paths.get_user_directory()) / "__topview_agent"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return root / (hashlib.sha256(token.encode()).hexdigest() + ".json")


def read_config(path):
    if not path.exists():
        return {"profiles": [], "active_id": ""}
    return json.loads(path.read_text(encoding="utf-8"))


def write_config(path, config):
    descriptor, name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(config, stream, ensure_ascii=False)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def public_config(config):
    return {"profiles": [{k: v for k, v in item.items() if k != "secret"} | {"has_key": bool(item.get("secret"))} for item in config["profiles"]], "active_id": config["active_id"], "presets": PRESETS}


def base_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise AgentError("Invalid API base URL")
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AgentError("Use an HTTP(S) API base URL without credentials, query or fragment.")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise AgentError("Use HTTPS for remote providers; HTTP is supported only for local servers.")
    if parsed.path.endswith("/chat/completions"):
        value = value[:-len("/chat/completions")]
    return value


def save_profile(config, body):
    identity = body.get("id", "")
    if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
        raise AgentError("Invalid profile ID")
    old = next((item for item in config["profiles"] if item["id"] == identity), None)
    url = base_url(body.get("base_url", ""))
    model = body.get("model", "").strip()
    if not model or len(model) > 200:
        raise AgentError("Enter a model ID from your provider.")
    key = body.get("api_key", "")
    if not isinstance(key, str) or len(key) > 8192 or "\n" in key or "\r" in key:
        raise AgentError("Invalid API key")
    key = key.strip()
    if not key and old and old["base_url"] != url:
        raise AgentError("Enter the API key again when changing the API address.")
    provider = body.get("provider", "custom")
    if provider not in {item["id"] for item in PRESETS}:
        raise AgentError("Unknown provider")
    item = {"id": identity, "name": str(body.get("name", ""))[:80] or provider,
            "provider": provider, "base_url": url, "model": model,
            "secret": protect_key(key) if key else (old or {}).get("secret", "")}
    if not item["secret"]:
        raise AgentError("Enter an API key (a placeholder is allowed for a local server).")
    config["profiles"] = [entry for entry in config["profiles"] if entry["id"] != identity] + [item]
    if len(config["profiles"]) > 30:
        raise AgentError("At most 30 profiles are supported.")
    config["active_id"] = identity
    return config


async def read_body(request):
    data = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        data.extend(chunk)
        if len(data) > MAX_BODY:
            raise AgentError("Agent request is too large. Start a new conversation.")
    body = json.loads(data)
    if not isinstance(body, dict):
        raise AgentError("Expected a JSON object")
    return body


async def provider_request(profile, route, payload=None):
    key = protect_key(profile["secret"], decrypt=True)
    url = base_url(profile["base_url"]) + route
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=180)) as session:
            async with session.request("POST" if payload is not None else "GET", url,
                                       headers={"Authorization": f"Bearer {key}"}, json=payload,
                                       allow_redirects=False) as response:
                data = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    data.extend(chunk)
                    if len(data) > 4 * MAX_BODY:
                        raise AgentError("Provider response is too large.")
                if response.status != 200:
                    reasons = {401: "API key rejected; check the provider and region", 403: "Access denied", 404: "API address or model not found", 429: "Rate limit or account quota reached"}
                    raise AgentError(f"HTTP {response.status}: {reasons.get(response.status, 'Provider rejected this request; check model/tool support and API settings')}")
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise AgentError("Provider returned an invalid response.")
                return result
    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
        raise AgentError("Provider connection failed or timed out. Check API address and network.") from error


def active_profile(config, identity=None):
    identity = identity or config["active_id"]
    profile = next((item for item in config["profiles"] if item["id"] == identity), None)
    if not profile:
        raise AgentError("Configure and save an API provider in Agent settings first.")
    return profile


def completion_payload(profile, messages, tools):
    payload = {"model": profile["model"], "messages": messages, "tools": tools, "stream": False}
    if profile["provider"].startswith("qwen-"):
        payload["enable_thinking"] = False
    if profile["provider"] == "deepseek":
        payload["thinking"] = {"type": "disabled"}
    return payload


def register_agent_routes(routes):
    async def handle(request):
        try:
            path = config_path(request)
            config = read_config(path)
            if request.method == "GET":
                return web.json_response(public_config(config), headers={"Cache-Control": "no-store"})
            body = await read_body(request)
            action = request.match_info["action"]
            if action == "save":
                config = save_profile(config, body)
                write_config(path, config)
                return web.json_response(public_config(config))
            if action == "delete":
                config["profiles"] = [item for item in config["profiles"] if item["id"] != body.get("id")]
                if config["active_id"] == body.get("id"):
                    config["active_id"] = config["profiles"][0]["id"] if config["profiles"] else ""
                write_config(path, config)
                return web.json_response(public_config(config))
            if action == "models" and isinstance(body.get("draft"), dict):
                # Validate credentials using an ephemeral config; fetching never saves or activates it.
                draft = {**body["draft"], "model": body["draft"].get("model") or "model-list"}
                temporary = save_profile({**config, "profiles": list(config["profiles"])}, draft)
                profile = active_profile(temporary, draft["id"])
            else:
                profile = active_profile(config, body.get("profile_id"))
            if action == "activate":
                config["active_id"] = profile["id"]
                write_config(path, config)
                return web.json_response(public_config(config))
            if action == "models":
                result = await provider_request(profile, "/models")
                return web.json_response({"models": sorted({item["id"] for item in result.get("data", []) if isinstance(item, dict) and isinstance(item.get("id"), str)})})
            if action == "test":
                tool = {"type": "function", "function": {"name": "connection_test", "description": "Verify tool calling", "parameters": {"type": "object", "properties": {}, "required": []}}}
                result = await provider_request(profile, "/chat/completions", completion_payload(profile, [{"role": "user", "content": "Call connection_test now to verify tool support. Do not answer in text."}], [tool]))
                message = result.get("choices", [{}])[0].get("message", {})
                passed = any(call.get("function", {}).get("name") == "connection_test" for call in message.get("tool_calls", []))
                return web.json_response({"connected": True, "tool_calls": passed})
            if action == "complete":
                messages, tool_defs = body.get("messages"), body.get("tools")
                if not isinstance(messages, list) or not messages or not isinstance(tool_defs, list) or len(tool_defs) > 20:
                    raise AgentError("Invalid conversation or tool definitions.")
                result = await provider_request(profile, "/chat/completions", completion_payload(profile, messages, tool_defs))
                choices = result.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0].get("message"), dict):
                    raise AgentError("Provider returned no assistant message.")
                message = choices[0]["message"]
                return web.json_response({"message": {k: message[k] for k in ("role", "content", "tool_calls", "reasoning_content") if k in message}, "finish_reason": choices[0].get("finish_reason")})
            raise AgentError("Unknown Agent action")
        except (AgentError, ValueError, KeyError, TypeError, IndexError) as error:
            # Never relay provider bodies, URLs containing credentials or stored secrets.
            detail = str(error) if isinstance(error, AgentError) else "Invalid Agent request or response. Check settings."
            return web.json_response({"error": detail}, status=400)

    routes.get("/topview3d/agent/config")(handle)
    routes.post("/topview3d/agent/{action}")(handle)
