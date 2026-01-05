-- Pandoc Lua filter to add color support for PPTX
-- Handles [text]{color=#RRGGBB} syntax

function Span(elem)
  local color = elem.attributes['color']
  if color then
    -- Remove # if present
    color = color:gsub('^#', '')

    -- Create raw OpenXML for colored text
    local content_text = pandoc.utils.stringify(elem.content)

    -- Check if content has bold
    local is_bold = false
    for _, item in ipairs(elem.content) do
      if item.t == 'Strong' then
        is_bold = true
        content_text = pandoc.utils.stringify(item.content)
        break
      end
    end

    local bold_attr = ''
    if is_bold then
      bold_attr = ' b="1"'
    end

    -- Return raw OOXML span with color
    local ooxml = string.format(
      '<a:r><a:rPr%s><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r>',
      bold_attr, color, content_text
    )

    return pandoc.RawInline('openxml', ooxml)
  end
  return elem
end
