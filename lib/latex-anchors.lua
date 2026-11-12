-- Paragraph anchors for a docx built from a LaTeX source (lib/latex-input.ts).
--
-- The adapter writes `\hypertarget{rp_...}{}` on its own line before each
-- paragraph unit; pandoc reads it as an empty Div carrying the id. This
-- filter moves the id onto the block that follows, so the docx bookmark sits
-- with the paragraph's text: as an empty Span at the start of a paragraph or
-- heading (the way Word itself stores a bookmark), or as a Div around any
-- other block. `docrev sync` reads these bookmarks back to anchor Word
-- comments to the source paragraph (lib/latex-sync.ts).

local PREFIX = '^rp_'

local function is_anchor(block)
  return block.t == 'Div' and #block.content == 0 and block.identifier:match(PREFIX) ~= nil
end

local function attach(ids, block)
  if block.t == 'Para' or block.t == 'Plain' or block.t == 'Header' then
    for i = #ids, 1, -1 do
      block.content:insert(1, pandoc.Span({}, pandoc.Attr(ids[i])))
    end
    return block
  end
  for i = #ids, 1, -1 do
    block = pandoc.Div({ block }, pandoc.Attr(ids[i]))
  end
  return block
end

function Blocks(blocks)
  local out = pandoc.Blocks({})
  local pending = {}
  for _, block in ipairs(blocks) do
    if is_anchor(block) then
      table.insert(pending, block.identifier)
    elseif #pending > 0 then
      out:insert(attach(pending, block))
      pending = {}
    else
      out:insert(block)
    end
  end
  -- Anchors with no block after them (a unit pandoc rendered as nothing) stay
  -- as empty Divs, which the docx writer still bookmarks.
  for _, id in ipairs(pending) do
    out:insert(pandoc.Div({}, pandoc.Attr(id)))
  end
  return out
end
