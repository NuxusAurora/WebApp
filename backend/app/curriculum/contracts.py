from typing import Annotated

from pydantic import Field, model_validator

from app.auth import Input

NODE_ID = r"^(tmp-[a-zA-Z0-9_-]{1,60}|[0-9a-f-]{36})$"
GAP_ID = r"^[0-9a-f]{32}$"
MAX_GAPS = 30
ReviewItem = Annotated[str, Field(min_length=1, max_length=300)]


class SectionInput(Input):
    id: str = Field(pattern=NODE_ID)
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


class GapLocation(Input):
    chapter_id: Annotated[str, Field(pattern=NODE_ID)] | None
    after_id: Annotated[str, Field(pattern=NODE_ID)] | None
    reason: str = Field(min_length=1, max_length=300, pattern=r"\S")


class GapInput(GapLocation):
    id: str = Field(pattern=GAP_ID)


class CurriculumInput(Input):
    chapters: list[ChapterInput] = Field(min_length=1, max_length=50)
    uncertain_items: list[ReviewItem] = Field(default_factory=list, max_length=100)
    gaps: list[GapInput] = Field(default_factory=list, max_length=MAX_GAPS)

    @model_validator(mode="after")
    def unique_nodes(self):
        nodes = [node for chapter in self.chapters for node in [chapter, *chapter.sections]]
        if len(nodes) > 500 or len({node.id for node in nodes}) != len(nodes):
            raise ValueError("Duplicate IDs or excessive nodes")
        siblings = {None: {chapter.id for chapter in self.chapters}}
        siblings.update(
            {chapter.id: {section.id for section in chapter.sections} for chapter in self.chapters}
        )
        if len({gap.id for gap in self.gaps}) != len(self.gaps) or any(
            gap.chapter_id not in siblings
            or (gap.after_id is not None and gap.after_id not in siblings[gap.chapter_id])
            for gap in self.gaps
        ):
            raise ValueError("Invalid curriculum gap anchors")
        return self

    def draft_payload(self):
        return self.model_dump(exclude={"gaps"} if not self.gaps else None)


class SectionSupplement(Input):
    complete: bool
    items: list[SectionInput] = Field(max_length=100)
    uncertain_items: list[ReviewItem] = Field(max_length=100)


class ChapterSupplement(SectionSupplement):
    items: list[ChapterInput] = Field(max_length=50)


def output_schema(strict=False, *, with_gaps=False):
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
    schema = {
        "type": "object",
        "properties": {
            "chapters": {"type": "array", "items": chapter, "maxItems": 50},
            "uncertain_items": {
                "type": "array",
                "items": {"type": "string", "minLength": 1, "maxLength": 300},
                "maxItems": 100,
            },
        },
        "required": ["chapters", "uncertain_items"] if strict else ["chapters"],
        "additionalProperties": False,
    }
    if with_gaps:
        schema["properties"]["gaps"] = {
            "type": "array",
            "maxItems": MAX_GAPS,
            "items": {
                "type": "object",
                "properties": {
                    "chapter_id": {"type": ["string", "null"]},
                    "after_id": {"type": ["string", "null"]},
                    "reason": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 300,
                        "pattern": r"\S",
                    },
                },
                "required": ["chapter_id", "after_id", "reason"],
                "additionalProperties": False,
            },
        }
        schema["required"].append("gaps")
    return schema


def supplement_schema(in_chapter: bool):
    properties = output_schema(strict=True)["properties"]
    chapters = properties["chapters"]
    return {
        "type": "object",
        "properties": {
            "complete": {"type": "boolean"},
            "items": chapters["items"]["properties"]["sections"] if in_chapter else chapters,
            "uncertain_items": properties["uncertain_items"],
        },
        "required": ["complete", "items", "uncertain_items"],
        "additionalProperties": False,
    }
