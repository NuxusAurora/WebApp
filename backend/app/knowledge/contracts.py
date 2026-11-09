from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.auth import Input

TextItem = Annotated[str, Field(min_length=1, max_length=500, pattern=r"\S")]


class PointInput(Input):
    temp_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    existing_knowledge_point_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200, pattern=r"\S")
    description: str = Field(min_length=1, max_length=4000, pattern=r"\S")
    learning_objectives: list[TextItem] = Field(min_length=1, max_length=20)
    importance: Literal["HIGH", "MEDIUM", "LOW"]
    mastery_criteria: list[TextItem] = Field(min_length=1, max_length=20)


class KnowledgeInput(Input):
    knowledge_points: list[PointInput] = Field(max_length=50)
    uncertain_items: list[TextItem] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [p.temp_id for p in self.knowledge_points]
        matches = [
            p.existing_knowledge_point_id
            for p in self.knowledge_points
            if p.existing_knowledge_point_id is not None
        ]
        if len(set(ids)) != len(ids) or len(set(matches)) != len(matches):
            raise ValueError("Duplicate knowledge point mapping")
        return self


def output_schema():
    text = {"type": "string", "minLength": 1, "maxLength": 500, "pattern": r"\S"}
    items = {"type": "array", "items": text, "minItems": 1, "maxItems": 20}
    properties = {
        "temp_id": {"type": "string", "pattern": "^[a-zA-Z0-9_-]{1,64}$"},
        "existing_knowledge_point_id": {"type": ["string", "null"]},
        "title": {"type": "string", "minLength": 1, "maxLength": 200, "pattern": r"\S"},
        "description": {"type": "string", "minLength": 1, "maxLength": 4000, "pattern": r"\S"},
        "learning_objectives": items,
        "importance": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
        "mastery_criteria": items,
    }
    return {
        "type": "object",
        "properties": {
            "knowledge_points": {
                "type": "array",
                "minItems": 1,
                "maxItems": 50,
                "items": {
                    "type": "object",
                    "properties": properties,
                    "required": list(properties),
                    "additionalProperties": False,
                },
            },
            "uncertain_items": {"type": "array", "items": text, "maxItems": 50},
        },
        "required": ["knowledge_points", "uncertain_items"],
        "additionalProperties": False,
    }
