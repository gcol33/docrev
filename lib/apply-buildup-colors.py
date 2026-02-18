"""
Apply buildup greying to PPTX slides.
Greys out all bullet items except the last one in each content placeholder.
"""
import zipfile
import sys
import re
import os

pptx_path = sys.argv[1]
temp_path = pptx_path + '.tmp'

GREY_COLOR = '888888'

def apply_grey_to_content_placeholder(text):
    """Find content placeholder and grey all paragraphs except the last"""
    # Find content placeholder (idx="1") shape
    content_match = re.search(r'(<p:sp>.*?<p:ph\s+idx="1"[^>]*/>.*?<p:txBody>)(.*?)(</p:txBody></p:sp>)', text, re.DOTALL)

    if not content_match:
        return text

    before = content_match.group(1)
    body_content = content_match.group(2)
    after = content_match.group(3)

    # Find all paragraphs in the body
    para_pattern = r'(<a:p>.*?</a:p>)'
    paras = list(re.finditer(para_pattern, body_content, re.DOTALL))

    if len(paras) <= 1:
        return text  # Nothing to grey if 0 or 1 paragraph

    # Grey out all but the last paragraph
    new_body = body_content
    offset = 0

    for match in paras[:-1]:  # All but last
        start = match.start() + offset
        end = match.end() + offset
        para = match.group(0)

        # Add grey color to all <a:r> (run) elements
        def add_grey_to_run(run_match):
            run = run_match.group(0)
            # Find <a:rPr> and add solidFill
            if '<a:solidFill>' in run:
                # Replace existing color
                run = re.sub(r'<a:srgbClr val="[^"]*"/>', f'<a:srgbClr val="{GREY_COLOR}"/>', run)
            elif '<a:rPr />' in run:
                # Replace self-closing rPr with one that has color
                run = run.replace('<a:rPr />', f'<a:rPr><a:solidFill><a:srgbClr val="{GREY_COLOR}"/></a:solidFill></a:rPr>')
            elif '<a:rPr>' in run:
                # Add solidFill after opening rPr tag
                run = re.sub(r'(<a:rPr[^>]*>)', r'\1<a:solidFill><a:srgbClr val="' + GREY_COLOR + r'"/></a:solidFill>', run)
            elif '</a:rPr>' in run:
                # Insert before closing rPr
                run = run.replace('</a:rPr>', f'<a:solidFill><a:srgbClr val="{GREY_COLOR}"/></a:solidFill></a:rPr>')
            else:
                # No rPr at all, add it after <a:r>
                run = run.replace('<a:r>', f'<a:r><a:rPr><a:solidFill><a:srgbClr val="{GREY_COLOR}"/></a:solidFill></a:rPr>')
            return run

        new_para = re.sub(r'<a:r>.*?</a:r>', add_grey_to_run, para, flags=re.DOTALL)

        new_body = new_body[:start] + new_para + new_body[end:]
        offset += len(new_para) - len(para)

    # Reconstruct the full text
    full_start = content_match.start()
    full_end = content_match.end()
    return text[:full_start] + before + new_body + after + text[full_end:]

with zipfile.ZipFile(pptx_path, 'r') as zin:
    with zipfile.ZipFile(temp_path, 'w') as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)

            # Process slide XML files
            if item.filename.startswith('ppt/slides/slide') and item.filename.endswith('.xml'):
                text = content.decode('utf-8')
                text = apply_grey_to_content_placeholder(text)
                content = text.encode('utf-8')

            zout.writestr(item, content)

os.replace(temp_path, pptx_path)
print('Buildup colors applied')
