# Bash completion for docrev (also installed as rev)
# Install: source this file or add to ~/.bashrc:
#   eval "$(docrev completions bash)"

_rev_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="build new import sections extract review status comments resolve reply strip refs migrate config install doi citations equations figures response anonymize validate merge diff history help init split word-count wc stats search backup export preview watch lint grammar annotate apply comment completions"
    local build_formats="pdf docx tex all"
    local doi_actions="check lookup fetch add"
    local eq_actions="list extract convert from-word"
    local help_topics="workflow syntax commands"
    local preview_formats="pdf docx"

    case "${prev}" in
        docrev|rev)
            COMPREPLY=($(compgen -W "${commands} --help --version" -- "${cur}"))
            return
            ;;
        build)
            COMPREPLY=($(compgen -W "${build_formats} --toc --show-changes --clean" -- "${cur}"))
            return
            ;;
        new)
            COMPREPLY=($(compgen -W "--list --template" -- "${cur}"))
            return
            ;;
        --template)
            COMPREPLY=($(compgen -W "paper minimal thesis proposal" -- "${cur}"))
            return
            ;;
        doi)
            COMPREPLY=($(compgen -W "${doi_actions}" -- "${cur}"))
            return
            ;;
        equations|eq)
            COMPREPLY=($(compgen -W "${eq_actions}" -- "${cur}"))
            return
            ;;
        validate)
            COMPREPLY=($(compgen -W "--journal --list" -- "${cur}"))
            return
            ;;
        --journal)
            COMPREPLY=($(compgen -W "nature science plos cell ecology custom" -- "${cur}"))
            return
            ;;
        help)
            COMPREPLY=($(compgen -W "${help_topics}" -- "${cur}"))
            return
            ;;
        config)
            COMPREPLY=($(compgen -W "user" -- "${cur}"))
            return
            ;;
        word-count|wc)
            COMPREPLY=($(compgen -W "--limit --journal" -- "${cur}"))
            return
            ;;
        preview)
            COMPREPLY=($(compgen -W "${preview_formats}" -- "${cur}"))
            return
            ;;
        watch)
            COMPREPLY=($(compgen -W "pdf docx all --no-open" -- "${cur}"))
            return
            ;;
        lint)
            COMPREPLY=($(compgen -W "--fix" -- "${cur}"))
            return
            ;;
        grammar)
            COMPREPLY=($(compgen -W "--learn --forget --list --rules --no-scientific --severity" -- "${cur}"))
            return
            ;;
        annotate)
            COMPREPLY=($(compgen -f -X '!*.docx' -- "${cur}"))
            return
            ;;
        apply)
            COMPREPLY=($(compgen -f -X '!*.md' -- "${cur}"))
            return
            ;;
        comment)
            COMPREPLY=($(compgen -f -X '!*.docx' -- "${cur}"))
            return
            ;;
        completions)
            COMPREPLY=($(compgen -W "bash zsh" -- "${cur}"))
            return
            ;;
        import|sections|extract|review|status|comments|strip|refs|migrate|figures|response|anonymize|split)
            # Complete with .md and .docx files
            COMPREPLY=($(compgen -f -X '!*.@(md|docx)' -- "${cur}"))
            return
            ;;
        resolve|reply)
            # Complete with -n option or .md files
            if [[ "${cur}" == -* ]]; then
                COMPREPLY=($(compgen -W "-n -m" -- "${cur}"))
            else
                COMPREPLY=($(compgen -f -X '!*.md' -- "${cur}"))
            fi
            return
            ;;
        check|lookup|add|fetch)
            # DOI subcommands - complete with .bib files
            COMPREPLY=($(compgen -f -X '!*.bib' -- "${cur}"))
            return
            ;;
        citations)
            COMPREPLY=($(compgen -f -X '!*.bib' -- "${cur}"))
            return
            ;;
        merge)
            # Complete with .md and .docx files
            COMPREPLY=($(compgen -f -X '!*.@(md|docx)' -- "${cur}"))
            return
            ;;
    esac

    # Default: complete with files
    COMPREPLY=($(compgen -f -- "${cur}"))
}

complete -F _rev_completions docrev rev
