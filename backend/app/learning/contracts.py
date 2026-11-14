"""Learning Protocol 1.0 contracts. The planner supplies content; the platform owns identity."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

ShortText = Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]
LessonText = Annotated[str, Field(min_length=1, max_length=3000, pattern=r"\S")]
Title = Annotated[str, Field(min_length=1, max_length=120, pattern=r"\S")]
PositiveIndex = Annotated[int, Field(strict=True, ge=1)]
Difficulty = Literal["beginner", "basic", "intermediate", "advanced"]


class LessonContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


class Step(LessonContract):
    index: PositiveIndex
    objective: ShortText
    concept: ShortText
    required_context: tuple[ShortText, ...]
    completion_criteria: Annotated[tuple[ShortText, ...], Field(min_length=1)]
    common_mistakes: tuple[ShortText, ...]
    forbidden: tuple[ShortText, ...]
    expected_takeaway: ShortText


class LessonPlanDraft(LessonContract):
    learning_objective: ShortText
    prerequisite_knowledge: tuple[ShortText, ...]
    problem: LessonText
    difficulty: Difficulty
    steps: Annotated[tuple[Step, ...], Field(min_length=1)]
    reference_answer: LessonText = Field(repr=False)

    @model_validator(mode="after")
    def validate_step_order(self) -> Self:
        if any(step.index != index for index, step in enumerate(self.steps, start=1)):
            raise ValueError("Lesson step indexes must be in order starting at 1")
        return self


class LessonPlan(LessonPlanDraft):
    """Internal validated plan; never use this as a student response."""

    plan_id: UUID
    question_id: UUID
    knowledge_point_id: UUID
    plan_version: PositiveIndex
    created_at: AwareDatetime

    @field_validator("created_at", mode="before")
    @classmethod
    def validate_created_at(cls, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            return datetime.fromisoformat(value)
        raise ValueError("Expected an ISO 8601 timestamp")


class StepOutput(LessonContract):
    title: Title
    content: LessonText


class NewQuestionOutput(StepOutput):
    """Student response: use the frozen problem and the rendered first step."""

    problem: LessonText

    @classmethod
    def from_plan(cls, plan: LessonPlan, first_step: StepOutput) -> Self:
        return cls(problem=plan.problem, title=first_step.title, content=first_step.content)


class TextOutput(LessonContract):
    text: LessonText


class CompletionOutput(LessonContract):
    status: Literal["completed"]


class LessonOperation(StrEnum):
    PLAN = "plan"
    START = "start"
    NEXT = "next"
    COMPLETE = "complete"
    NEXT_QUESTION = "next_question"
    REPHRASE = "rephrase"
    HINT = "hint"
    CHECK_QUESTION = "check_question"
    CHECK_FEEDBACK = "check_feedback"
    ASSISTANT = "assistant"


_OUTPUTS = {
    LessonOperation.PLAN: LessonPlanDraft,
    LessonOperation.START: NewQuestionOutput,
    LessonOperation.NEXT: StepOutput,
    LessonOperation.COMPLETE: CompletionOutput,
    LessonOperation.NEXT_QUESTION: NewQuestionOutput,
    LessonOperation.REPHRASE: TextOutput,
    LessonOperation.HINT: TextOutput,
    LessonOperation.CHECK_QUESTION: TextOutput,
    LessonOperation.CHECK_FEEDBACK: TextOutput,
    LessonOperation.ASSISTANT: TextOutput,
}


def operation_output_schema(operation: LessonOperation) -> dict:
    """Build a schema for the assembled result in protocol section 6."""
    return _json_schema(_OUTPUTS[operation])


def _model_output_contract(operation: LessonOperation) -> type[LessonContract]:
    if operation == LessonOperation.COMPLETE:
        raise ValueError("Completion is a platform operation with no model output")
    if operation in (LessonOperation.START, LessonOperation.NEXT_QUESTION):
        return StepOutput
    return _OUTPUTS[operation]


def model_output_schema(operation: LessonOperation) -> dict:
    """Build a gateway-compatible schema; the tutor never supplies the problem."""
    return _json_schema(_model_output_contract(operation))


def _json_schema(contract: type[LessonContract]) -> dict:
    schema = contract.model_json_schema()
    definitions = schema.pop("$defs", {})

    def inline(value):
        # These references are generated locally. The gateway rejects all references.
        if isinstance(value, dict):
            fields = {key: inline(child) for key, child in value.items() if key != "$ref"}
            if "$ref" in value:
                name = value["$ref"].removeprefix("#/$defs/")
                return inline(definitions[name]) | fields
            return fields
        if isinstance(value, list):
            return [inline(item) for item in value]
        return value

    return inline(schema)


def validate_model_output(operation: LessonOperation, payload: object) -> LessonContract:
    """Validate parsed model output, including rules that JSON Schema cannot express."""
    return _model_output_contract(operation).model_validate(payload)
