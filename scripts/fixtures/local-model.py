"""Isolated protocol fixture, not an AI model. Copied only into acceptance containers."""

import json
import time
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
        if body["model"] == "curriculum-fixture":
            text = json.dumps({"chapters": [{"id": "tmp-c1", "title": "第一章 函数与极限", "page_start": 1, "page_end": None,
                "sections": [{"id": "tmp-s1", "title": "1.1 映射与函数", "page_start": 1, "page_end": None},
                             {"id": "tmp-s2", "title": "1.2 数列的极限", "page_start": 12, "page_end": None}]}], "uncertain_items": []})
        if body["model"] == "knowledge-fixture":
            text = json.dumps({"knowledge_points": [{"temp_id": "kp_001", "existing_knowledge_point_id": None,
                "title": "函数的定义", "description": "两个集合间的唯一对应。", "learning_objectives": ["解释函数的定义"],
                "importance": "HIGH", "mastery_criteria": ["判断一个对应是否为函数"]}]})
        if body["model"] in {"lesson-fixture", "lesson-evaluation-error", "lesson-delayed"}:
            text = lesson_response(body)
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


def lesson_response(body):
    messages = body["messages"]
    system = next(message["content"] for message in messages
                  if message["role"] == "system" and message["content"].startswith(
                      ("你是", "给当前", "对当前", "生成一道", "评价学生")))
    if body["model"] == "lesson-evaluation-error":
        return "invalid output"
    if body["model"] == "lesson-delayed":
        time.sleep(2)
    if "独立学习助手" in system:
        return json.dumps({"text": "因为函数定义要求每个输入恰好对应一个输出。"})
    user = json.loads(next(message["content"] for message in messages if message["role"] == "user"))
    if "教学规划器" in system:
        step = {
            "concept": "唯一对应", "required_context": [], "completion_criteria": ["识别输入的输出"],
            "common_mistakes": [], "forbidden": ["不要提前宣布整体关系的判断结论"], "expected_takeaway": "逐个核对输入",
        }
        problem = "解释一个人可以拥有多个电话号码时，为什么从人到电话号码可能不是函数。"
        if not user["previous_problem"]:
            problem = "判断集合 A 到 B 的下列对应是否为函数。\n\n$$f(x)=x+1$$"
        return json.dumps({
            "problem": problem, "learning_objective": "理解函数的唯一对应", "difficulty": "basic",
            "prerequisite_knowledge": [], "reference_answer": "每个输入应当恰好对应一个输出才构成函数",
            "steps": [dict(step, index=1, objective="识别输入"), dict(step, index=2, objective="核对对应")],
        })
    if "步骤讲解器" in system:
        stage = user["step"]["index"]
        code = "\n\n```text\n" + "input ".strip() * 30 + "\n```" if stage == 1 else ""
        return json.dumps({"title": user["step"]["objective"], "content": f"先完成本步任务 {stage}。{code}"})
    if "level" in user:
        return json.dumps({"text": f"观察提示 {user['level']}。"})
    return json.dumps({"text": "关注同一个输入对应的输出个数。"})


ThreadingHTTPServer(("127.0.0.1", 1234), Handler).serve_forever()
