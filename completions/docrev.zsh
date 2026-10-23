#compdef docrev rev

# Zsh completion for docrev (also installed as rev)
# Install: add to fpath or run:
#   eval "$(docrev completions zsh)"

_rev() {
    local -a commands build_formats doi_actions eq_actions help_topics journals preview_formats

    commands=(
        'build:Build PDF/DOCX/TEX from sections'
        'new:Create new project from template'
        'import:Import Word document'
        'sections:Import to section files'
        'extract:Extract text from Word'
        'review:Interactive review TUI'
        'status:Show annotation counts'
        'comments:List comments'
        'resolve:Mark comment as resolved'
        'reply:Reply to comments'
        'strip:Output clean markdown'
        'refs:Show reference status'
        'migrate:Convert hardcoded refs'
        'config:Configure settings'
        'install:Check dependencies'
        'doi:DOI validation'
        'citations:Validate citations'
        'equations:Extract equations'
        'figures:List figures'
        'response:Generate response letter'
        'anonymize:Prepare for blind review'
        'validate:Check journal requirements'
        'merge:Merge reviewer feedback'
        'diff:Compare against git history'
        'history:Show revision history'
        'help:Show help'
        'init:Initialize project'
        'split:Split paper.md to sections'
        'word-count:Show word counts per section'
        'wc:Show word counts (alias)'
        'stats:Show project statistics'
        'search:Search across files'
        'backup:Create timestamped backup'
        'export:Export project as zip'
        'preview:Build and open document'
        'watch:Watch and auto-rebuild'
        'lint:Check for issues'
        'grammar:Check grammar and style'
        'annotate:Add comments to DOCX'
        'apply:Apply annotations as track changes'
        'comment:Interactive comment mode'
        'completions:Generate shell completions'
    )

    preview_formats=(
        'pdf:Preview PDF'
        'docx:Preview Word document'
    )

    build_formats=(
        'pdf:Build PDF'
        'docx:Build Word document'
        'tex:Build LaTeX'
        'all:Build all formats'
    )

    doi_actions=(
        'check:Validate DOIs'
        'lookup:Find missing DOIs'
        'fetch:Get BibTeX from DOI'
        'add:Add citation by DOI'
    )

    eq_actions=(
        'list:List equations'
        'extract:Extract to file'
        'convert:Convert to Word'
        'from-word:Extract from Word'
    )

    help_topics=(
        'workflow:Review workflow'
        'syntax:CriticMarkup syntax'
        'commands:All commands'
    )

    journals=(
        'nature:Nature journal'
        'science:Science journal'
        'plos:PLOS ONE'
        'cell:Cell journal'
        'ecology:Ecology journals'
        'custom:Custom profile'
    )

    case "$words[2]" in
        build)
            _describe -t formats 'format' build_formats
            _arguments \
                '--toc[Include table of contents]' \
                '--show-changes[Show track changes in DOCX]' \
                '--clean[Clean build files]'
            ;;
        new)
            _arguments \
                '--list[List templates]' \
                '--template[Template name]:template:(paper minimal thesis proposal)'
            ;;
        doi)
            _describe -t actions 'action' doi_actions
            ;;
        equations|eq)
            _describe -t actions 'action' eq_actions
            ;;
        validate)
            _arguments \
                '--list[List journals]' \
                '--journal[Journal name]:journal:($journals)'
            ;;
        help)
            _describe -t topics 'topic' help_topics
            ;;
        config)
            _values 'setting' 'user[Set user name]'
            ;;
        word-count|wc)
            _arguments \
                '--limit[Word limit]:number:' \
                '--journal[Use journal word limit]:journal:'
            ;;
        preview)
            _describe -t formats 'format' preview_formats
            ;;
        watch)
            _arguments \
                '--no-open[Do not open after build]'
            _values 'format' 'pdf' 'docx' 'all'
            ;;
        lint)
            _arguments \
                '--fix[Auto-fix issues]'
            ;;
        grammar)
            _arguments \
                '--learn[Add word to dictionary]:word:' \
                '--forget[Remove from dictionary]:word:' \
                '--list[List dictionary words]' \
                '--rules[List grammar rules]' \
                '--no-scientific[Disable science rules]' \
                '--severity[Minimum severity]:level:(error warning info)'
            _files -g '*.md'
            ;;
        annotate)
            _arguments \
                '-m[Comment message]:text:' \
                '-s[Search text]:text:' \
                '-a[Author name]:name:'
            _files -g '*.docx'
            ;;
        apply)
            _arguments \
                '-a[Author name]:name:'
            _files -g '*.md'
            ;;
        comment)
            _arguments \
                '-a[Author name]:name:'
            _files -g '*.docx'
            ;;
        completions)
            _values 'shell' 'bash' 'zsh'
            ;;
        import|sections|extract|review|status|comments|strip|refs|migrate|figures|response|anonymize|split|search|stats)
            _files -g '*.md' -g '*.docx'
            ;;
        resolve|reply)
            _arguments \
                '-n[Comment number]:number:' \
                '-m[Reply message]:message:'
            _files -g '*.md'
            ;;
        check|lookup|add|citations)
            _files -g '*.bib'
            ;;
        merge)
            _files -g '*.md' -g '*.docx'
            ;;
        backup)
            _arguments \
                '--name[Custom backup name]:name:' \
                '--output[Output directory]:dir:_files -/'
            ;;
        export)
            _arguments \
                '--output[Output filename]:file:' \
                '--include-output[Include built files]'
            ;;
        *)
            _describe -t commands 'command' commands
            _arguments \
                '--help[Show help]' \
                '--version[Show version]'
            ;;
    esac
}

if [[ "$funcstack[1]" == "_rev" ]]; then
    _rev "$@"
else
    compdef _rev docrev rev
fi
