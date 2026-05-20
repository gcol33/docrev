--[[
docrev macro filter.

Reads a JSON sidecar describing one-argument LaTeX-style macros and expands
them per output FORMAT. Used for the built-in \tofill{X} (bold orange [X]
placeholder) and any user-declared macros from rev.yaml.

Sidecar path is passed via the DOCREV_MACROS_FILE environment variable, set
by build.ts before spawning pandoc. Env vars (not metadata) because pandoc's
filter traversal runs RawInline/RawBlock BEFORE Meta, so by the time we'd
read metadata the inline expansions have already happened.

Why raw OpenXML for docx? Pandoc 3.x's docx writer does NOT honor
`Span{style="color: #..."}` — those spans render as plain text with no
<w:color> run property. So for docx we emit raw <w:r> nodes directly. Same
reasoning for the pptx-color-filter.

For latex/pdf/beamer the markdown source already contains \tofill{X} as a raw
LaTeX inline; we leave it alone because build.ts injects a \providecommand
into header-includes. For html we emit a raw <span> with inline style. For
everything else (markdown, gfm, plain) we degrade to **bold [X]** so the
placeholder never silently disappears.
]]

local json = require('pandoc.json')

local macros_by_name = {}

local function load_sidecar()
  local path = os.getenv('DOCREV_MACROS_FILE')
  if not path or path == '' then
    return
  end
  local fh = io.open(path, 'r')
  if not fh then
    io.stderr:write('docrev macro-filter: cannot read sidecar: ' .. path .. '\n')
    return
  end
  local content = fh:read('*a')
  fh:close()
  local ok, parsed = pcall(json.decode, content)
  if not ok or type(parsed) ~= 'table' or type(parsed.macros) ~= 'table' then
    io.stderr:write('docrev macro-filter: malformed sidecar JSON\n')
    return
  end
  for _, m in ipairs(parsed.macros) do
    if type(m) == 'table' and type(m.name) == 'string' then
      macros_by_name[m.name] = m
    end
  end
end

load_sidecar()

local function xml_escape(s)
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function html_escape(s)
  return (s
    :gsub('&', '&amp;')
    :gsub('<', '&lt;')
    :gsub('>', '&gt;')
    :gsub('"', '&quot;'))
end

-- Resolve effective style for a macro in the current pandoc format.
-- Per-format entry wins over `default` (replacement, not merge — matches
-- macros.ts semantics).
local function pick_style(macro, format)
  if macro.formats and macro.formats[format] then
    return macro.formats[format]
  end
  return macro.default or {}
end

-- Build the inside of the bracket: [prefix][arg][suffix], optionally without
-- brackets when style.bracket == false.
local function compose_text(style, arg)
  local prefix = style.prefix or ''
  local suffix = style.suffix or ''
  local inner = prefix .. arg .. suffix
  if style.bracket == false then
    return inner
  end
  return '[' .. inner .. ']'
end

local function render_docx_run(style, arg)
  local rpr = {}
  if style.color then
    table.insert(rpr, '<w:color w:val="' .. style.color .. '"/>')
  end
  if style.bold then
    table.insert(rpr, '<w:b/>')
  end
  if style.italic then
    table.insert(rpr, '<w:i/>')
  end
  local rpr_xml = ''
  if #rpr > 0 then
    rpr_xml = '<w:rPr>' .. table.concat(rpr) .. '</w:rPr>'
  end
  local text = xml_escape(compose_text(style, arg))
  return '<w:r>' .. rpr_xml ..
         '<w:t xml:space="preserve">' .. text .. '</w:t></w:r>'
end

local function render_html(style, arg)
  local css = {}
  if style.color then
    table.insert(css, 'color:#' .. style.color)
  end
  if style.bold then
    table.insert(css, 'font-weight:bold')
  end
  if style.italic then
    table.insert(css, 'font-style:italic')
  end
  local text = html_escape(compose_text(style, arg))
  if #css == 0 then
    return '<span>' .. text .. '</span>'
  end
  return '<span style="' .. table.concat(css, ';') .. '">' .. text .. '</span>'
end

-- Fallback path: produce native pandoc inlines so the macro never silently
-- disappears in markdown/gfm/plain output. Used when the current format has
-- no native rich-text path (or we couldn't open the sidecar).
local function fallback_inlines(style, arg)
  local doc = pandoc.read(compose_text(style, arg), 'markdown')
  local inlines = pandoc.utils.blocks_to_inlines(doc.blocks)
  if style.bold then
    inlines = { pandoc.Strong(inlines) }
  end
  if style.italic then
    inlines = { pandoc.Emph(inlines) }
  end
  return inlines
end

-- Match `\NAME{...}` (with balanced braces inside the argument is NOT
-- supported — the use case is plain placeholder text, mirroring the reference
-- filter; users who need nested braces should use a different mechanism).
local function parse_call(text)
  local name, arg = text:match('^\\([A-Za-z][A-Za-z0-9]*)%s*{(.*)}%s*$')
  if name and arg and macros_by_name[name] then
    return name, arg
  end
  return nil, nil
end

local function expand_inline(el)
  if el.format ~= 'tex' and el.format ~= 'latex' then
    return nil
  end
  local name, arg = parse_call(el.text)
  if not name then return nil end
  local macro = macros_by_name[name]
  local style = pick_style(macro, FORMAT)

  if FORMAT == 'docx' then
    return pandoc.RawInline('openxml', render_docx_run(style, arg))
  elseif FORMAT == 'html' or FORMAT == 'html4' or FORMAT == 'html5' or FORMAT == 'chunkedhtml' then
    return pandoc.RawInline('html', render_html(style, arg))
  elseif FORMAT == 'latex' or FORMAT == 'beamer' or FORMAT == 'context' then
    -- Leave the raw LaTeX as-is. build.ts injects \providecommand into
    -- header-includes, so the LaTeX engine renders it directly.
    return nil
  else
    return fallback_inlines(style, arg)
  end
end

local function expand_block(el)
  if el.format ~= 'tex' and el.format ~= 'latex' then
    return nil
  end
  local name, arg = parse_call(el.text)
  if not name then return nil end
  local macro = macros_by_name[name]
  local style = pick_style(macro, FORMAT)

  if FORMAT == 'docx' then
    return pandoc.RawBlock('openxml', '<w:p>' .. render_docx_run(style, arg) .. '</w:p>')
  elseif FORMAT == 'html' or FORMAT == 'html4' or FORMAT == 'html5' or FORMAT == 'chunkedhtml' then
    return pandoc.RawBlock('html', '<p>' .. render_html(style, arg) .. '</p>')
  elseif FORMAT == 'latex' or FORMAT == 'beamer' or FORMAT == 'context' then
    return nil
  else
    return pandoc.Para(fallback_inlines(style, arg))
  end
end

function RawInline(el)
  return expand_inline(el)
end

function RawBlock(el)
  return expand_block(el)
end
