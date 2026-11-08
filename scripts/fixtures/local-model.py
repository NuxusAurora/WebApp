"""Isolated protocol fixture, not an AI model. Copied only into acceptance containers."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ready")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path != "/v1/chat/completions" or not body.get("messages"):
            self.send_error(400)
            return
        if body["model"] == "invalid-key-model":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"private-provider-error"}}')
            return
        text = '{"ok":true}' if body.get("response_format") else "local protocol fixture OK"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if body.get("stream") else "application/json")
        self.end_headers()
        if body.get("stream"):
            for value in [
                {"choices": [{"delta": {"content": text[:8]}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": text[8:]}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 8, "completion_tokens": 4}},
            ]:
                self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.wfile.write(json.dumps({"choices": [{"message": {"content": text},
                                                      "finish_reason": "stop"}],
                                        "usage": {"prompt_tokens": 8, "completion_tokens": 4}}).encode())


ThreadingHTTPServer(("127.0.0.1", 1234), Handler).serve_forever()
