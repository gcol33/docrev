-- Rewrite .md links to .html in pandoc output
function Link(el)
  el.target = el.target:gsub("%.md$", ".html")
  el.target = el.target:gsub("%.md#", ".html#")
  return el
end
