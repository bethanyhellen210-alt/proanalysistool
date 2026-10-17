import http.server
import socketserver
import os
import json
import hashlib
import secrets
import hmac
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

PORT = int(os.environ.get("PORT", "5000"))
DIRECTORY = "."

def utcnow():
    return datetime.now(timezone.utc)

def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")

def digest(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()

def db(table, method="GET", query="", body=None):
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not service:
        raise RuntimeError("Server access database is not configured.")
    url = base + "/rest/v1/" + table + (("?" + query) if query else "")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": service,
        "Authorization": "Bearer " + service,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    })
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Access database request failed (" + str(exc.code) + ").")

def valid_key(value):
    key = str(value or "").strip().upper()
    if len(key) < 12 or len(key) > 80 or not all(c.isalnum() or c == "-" for c in key):
        return None
    rows = db("access_keys", query="key_hash=eq." + urllib.parse.quote(digest(key), safe="") + "&revoked_at=is.null&select=id,label,expires_at&limit=1")
    if not rows:
        return None
    if rows[0].get("expires_at") and datetime.fromisoformat(rows[0]["expires_at"].replace("Z", "+00:00")) <= utcnow():
        return None
    return rows[0]

def admin_ok(handler, body):
    expected = os.environ.get("ACCESS_ADMIN_KEY", "")
    supplied = handler.headers.get("x-admin-key", "") or str(body.get("adminKey", ""))
    return len(expected) >= 24 and hmac.compare_digest(supplied, expected)

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Serve the public Deriv App ID from the current host's environment.
        # This route is needed when running the included Python server (for example on Replit);
        # static-file fallback would otherwise return index.html to the JSON fetch.
        request_path = urllib.parse.urlparse(self.path).path
        if request_path == "/api/deriv-config":
            app_id = str(os.environ.get("DERIV_APP_ID", "")).strip()
            if not app_id:
                return self.send_json(503, {
                    "error": "DERIV_APP_ID is not configured in the hosting environment."
                })
            if not app_id.isdigit():
                return self.send_json(503, {
                    "error": "The Deriv v3 WebSocket API requires the numeric App ID from your registered Deriv application. Set DERIV_APP_ID to that numeric ID."
                })
            return self.send_json(200, {"appId": app_id})

        requested_path = self.translate_path(self.path)
        if not os.path.exists(requested_path) or os.path.isdir(requested_path):
            self.path = "/index.html"
        return super().do_GET()

    def send_json(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/access":
            return self.send_json(404, {"error": "Not found."})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 20000)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            action = str(body.get("action", ""))

            if action == "validate":
                record = valid_key(body.get("accessKey"))
                if not record:
                    return self.send_json(401, {"error": "Invalid, expired, or revoked access key."})
                token = secrets.token_urlsafe(32)
                expires = utcnow() + timedelta(hours=12)
                db("access_sessions", "POST", body={
                    "key_id": record["id"], "token_hash": digest(token), "expires_at": iso(expires)
                })
                return self.send_json(200, {"ok": True, "sessionToken": token, "expiresAt": iso(expires),
                                            "user": {"username": record.get("label") or "Authorized user"}})

            if action == "session":
                token = str(body.get("sessionToken", ""))
                if len(token) < 32:
                    return self.send_json(401, {"valid": False})
                rows = db("access_sessions", query="token_hash=eq." + urllib.parse.quote(digest(token), safe="") +
                          "&revoked_at=is.null&expires_at=gt." + urllib.parse.quote(iso(utcnow()), safe="") +
                          "&select=id,key_id,expires_at&limit=1")
                if not rows:
                    return self.send_json(401, {"valid": False})
                keys = db("access_keys", query="id=eq." + urllib.parse.quote(rows[0]["key_id"], safe="") +
                          "&revoked_at=is.null&select=id,label,expires_at&limit=1")
                if not keys:
                    return self.send_json(401, {"valid": False})
                if keys[0].get("expires_at") and datetime.fromisoformat(keys[0]["expires_at"].replace("Z", "+00:00")) <= utcnow():
                    return self.send_json(401, {"valid": False})
                return self.send_json(200, {"valid": True, "expiresAt": rows[0]["expires_at"],
                                            "user": {"username": keys[0].get("label") or "Authorized user"}})

            if action not in ("create", "list", "revoke"):
                return self.send_json(400, {"error": "Unknown action."})
            if not admin_ok(self, body):
                return self.send_json(403, {"error": "Admin authorization required."})

            if action == "create":
                label = str(body.get("label", "")).strip()[:100]
                if not label:
                    return self.send_json(400, {"error": "Enter a user or key label."})
                raw_days = body.get("days")
                days = None if raw_days in ("", None) else int(raw_days)
                if days is not None and not 1 <= days <= 3650:
                    return self.send_json(400, {"error": "Expiry must be 1–3650 days, or blank for no expiry."})
                key = "MT-" + secrets.token_hex(18).upper()
                expires = iso(utcnow() + timedelta(days=days)) if days is not None else None
                rows = db("access_keys", "POST", body={"label": label, "key_hash": digest(key),
                          "expires_at": expires, "created_by": "admin"})
                return self.send_json(200, {"ok": True, "accessKey": key,
                    "key": {"id": rows[0]["id"], "label": label, "created_at": rows[0]["created_at"], "expires_at": expires}})

            if action == "list":
                rows = db("access_keys", query="select=id,label,created_at,expires_at,revoked_at&order=created_at.desc&limit=200")
                return self.send_json(200, {"keys": rows})

            key_id = str(body.get("id", ""))
            if len(key_id) != 36:
                return self.send_json(400, {"error": "Invalid key ID."})
            now = iso(utcnow())
            rows = db("access_keys", "PATCH", "id=eq." + urllib.parse.quote(key_id, safe="") + "&revoked_at=is.null",
                      {"revoked_at": now})
            if rows:
                db("access_sessions", "PATCH", "key_id=eq." + urllib.parse.quote(key_id, safe="") + "&revoked_at=is.null",
                   {"revoked_at": now})
            return self.send_json(200, {"ok": True, "revoked": bool(rows)})
        except Exception as exc:
            print("Access API error:", str(exc))
            return self.send_json(500, {"error": "Access service unavailable. Check server environment and database setup."})

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
    print("Serving Matchestool.pro at http://localhost:" + str(PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
