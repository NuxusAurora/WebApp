from typing import Annotated

from pydantic import Field, model_validator

from app.auth import Input


class SectionInput(Input):
    id: str = Field(pattern=r"^(tmp-[a-zA-Z0-9_-]{1,60}|[0-9a-f-]{36})$")
    title: str = Field(min_length=1, max_length=200, pattern=r"\S")
    page_start: int | None = Field(default=None, ge=1, le=100000)
    page_end: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def page_range(self):
        if (
            self.page_start is not None
            and self.page_end is not None
            and self.page_end < self.page_start
        ):
            raise ValueError("Invalid page range")
        return self


class ChapterInput(SectionInput):
    sections: list[SectionInput] = Field(default_factory=list, max_length=100)


class CurriculumInput(Input):
    chapters: list[ChapterInput] = Field(min_length=1, max_length=50)
    uncertain_items: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(
        default_factory=list, max_length=100
    )

    @model_validator(mode="after")
    def unique_nodes(self):
        nodes = [node for chapter in self.chapters for node in [chapter, *chapter.sections]]
        if len(nodes) > 500 or len({node.id for node in nodes}) != len(nodes):
            raise ValueError("Duplicate IDs or excessive nodes")
        return self


def output_schema(strict=False):
    # Inline the small schema: the Gateway deliberately rejects all $ref references.
    node = {
        "type": "object",
        "properties": {
            "id": {"type": "string", "pattern": "^tmp-[a-zA-Z0-9_-]{1,60}$"},
            "title": {"type": "string", "minLength": 1, "maxLength": 200, "pattern": r"\S"},
            "page_start": {"type": ["integer", "null"], "minimum": 1, "maximum": 100000},
            "page_end": {"type": ["integer", "null"], "minimum": 1, "maximum": 100000},
        },
        "required": ["id", "title", "page_start", "page_end"] if strict else ["id", "title"],
        "additionalProperties": False,
    }
    chapter = {
        **node,
        "properties": {
            **node["properties"],
            "sections": {"type": "array", "items": node, "maxItems": 100},
        },
        "required": ["id", "title", "page_start", "page_end", "sections"]
        if strict
        else ["id", "title", "sections"],
    }
    return {
        "type": "object",
        "properties": {
            "chapters": {"type": "array", "items": chapter, "minItems": 1, "maxItems": 50},
            "uncertain_items": {
                "type": "array",
                "items": {"type": "string", "minLength": 1, "maxLength": 300},
                "maxItems": 100,
            },
        },
        "required": ["chapters", "uncertain_items"] if strict else ["chapters"],
        "additionalProperties": False,
    }
