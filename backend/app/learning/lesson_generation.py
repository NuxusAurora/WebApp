import json
from pathlib import Path

from pydantic import ValidationError

from app.ai.contracts import AIError, Call, Message
from app.ai.service import prepare, public_error
from app.auth import limit
from app.errors import AppError
from app.learning.context import teaching_model
from app.learning.contracts import LessonOperation, model_output_schema, validate_model_output

PROMPT_DIRECTORY = Path(__file__).resolve().parents[2] / "prompts" / "learning"
PROMPTS = {
    LessonOperation.PLAN: "plan-v1",
    LessonOperation.NEXT: "step-v1",
    LessonOperation.EXPLAIN_SUBQUESTION: "explain-subquestion-v1",
    LessonOperation.HINT: "hint-v1",
    LessonOperation.REPHRASE: "rephrase-v1",
    LessonOperation.CHECK_QUESTION: "check-question-v1",
    LessonOperation.CHECK_FEEDBACK: "check-feedback-v1",
}


class LessonGenerator:
    def __init__(self, db, request, actor_id):
        self.db = db
        self.request = request
        self.actor_id = actor_id

    async def generate(self, operation, context):
        provider, model, _ = await teaching_model(self.db, self.actor_id)
        await limit(self.request, "lesson-ai", str(self.actor_id), maximum=24)
        prompt = PROMPTS[operation]
        instructions = (PROMPT_DIRECTORY / f"{prompt}.md").read_text("utf-8")
        if operation != LessonOperation.EXPLAIN_SUBQUESTION and "active_subquestion" in context:
            instructions += (
                "\nactive_subquestion 是学生当前选中的小题。"
                "优先围绕该题，在既定步骤和禁止项范围内讲解。"
            )
        call = Call(
            task_type="knowledge_lesson",
            prompt_version=prompt,
            messages=[
                Message(role="system", content=instructions),
                Message(role="user", content=json.dumps(context, ensure_ascii=False)),
            ],
            timeout=55,
            max_output_tokens=3600 if operation == LessonOperation.PLAN else 1800,
            output_schema=model_output_schema(operation),
        )
        target, sink, _ = await prepare(self.request, self.db, self.actor_id, provider, model, call)
        try:
            result = await self.request.app.state.ai_gateway.execute(target, call, sink)
            return validate_model_output(operation, result.structured)
        except AIError as error:
            code = {
                "AI_TIMEOUT": "MODEL_TIMEOUT",
                "AI_SCHEMA_MISMATCH": "MODEL_OUTPUT_INVALID",
                "AI_RATE_LIMITED": "RATE_LIMITED",
            }.get(error.code)
            if code:
                raise AppError(code, public_error(error).message, 502) from None
            raise public_error(error) from None
        except ValidationError, ValueError:
            code = (
                "PLAN_VALIDATION_FAILED"
                if operation == LessonOperation.PLAN
                else "MODEL_OUTPUT_INVALID"
            )
            raise AppError(code, "教学内容未通过校验，请重试", 502) from None
