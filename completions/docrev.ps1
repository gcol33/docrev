# PowerShell completion for docrev (also installed as rev)
# Install: Add to $PROFILE:
#   . (docrev completions powershell)
# Or copy output to profile manually

$script:revCommands = @(
    'build', 'new', 'import', 'sections', 'extract', 'review', 'status',
    'comments', 'resolve', 'reply', 'strip', 'refs', 'migrate', 'config',
    'install', 'doi', 'citations', 'equations', 'figures', 'response',
    'anonymize', 'validate', 'merge', 'diff', 'history', 'help', 'init',
    'split', 'sync', 'word-count', 'wc', 'stats', 'search', 'backup',
    'archive', 'export', 'preview', 'watch', 'lint', 'grammar', 'spelling',
    'annotate', 'apply', 'comment', 'completions', 'clean', 'check', 'open',
    'next', 'prev', 'first', 'last', 'todo', 'accept', 'reject',
    'pdf-comments', 'install-cli-skill', 'uninstall-cli-skill', 'doctor', 'upgrade'
)

$script:buildFormats = @('pdf', 'docx', 'tex', 'all')
$script:doiActions = @('check', 'lookup', 'fetch', 'add')
$script:eqActions = @('list', 'extract', 'convert', 'from-word')
$script:helpTopics = @('workflow', 'syntax', 'commands')
$script:previewFormats = @('pdf', 'docx')
$script:shells = @('bash', 'zsh', 'powershell')

Register-ArgumentCompleter -Native -CommandName docrev, rev -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.CommandElements
    $command = $null

    # Find the subcommand (skip the program name itself)
    if ($tokens.Count -gt 1) {
        $command = $tokens[1].Extent.Text
    }

    # Get the current word being completed
    $currentWord = $wordToComplete

    # If we're completing the first argument (subcommand)
    if ($tokens.Count -le 2 -and -not $currentWord.StartsWith('-')) {
        $script:revCommands | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    # Context-specific completions
    switch ($command) {
        'build' {
            if ($currentWord.StartsWith('-')) {
                @('--toc', '--show-changes', '--clean', '--dual') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
            } else {
                $script:buildFormats | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'new' {
            @('--list', '--template', '-s') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'doi' {
            $script:doiActions | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        { $_ -in @('equations', 'eq') } {
            $script:eqActions | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'validate' {
            @('--list', '--journal') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'help' {
            $script:helpTopics | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'config' {
            @('user', 'sections') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        { $_ -in @('word-count', 'wc') } {
            @('--limit', '--journal') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'preview' {
            $script:previewFormats | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'watch' {
            if ($currentWord.StartsWith('-')) {
                @('--no-open') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
            } else {
                @('pdf', 'docx', 'all') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'completions' {
            $script:shells | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'comments' {
            @('--pending', '-p', '--resolved', '-r', '--export', '-e', '--author') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
            # Also complete .md files
            Get-ChildItem -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
        }
        { $_ -in @('resolve', 'reply') } {
            @('-n', '-m', '--number', '--message', '--author', '-a') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
            Get-ChildItem -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
        }
        { $_ -in @('accept', 'reject') } {
            @('-n', '-a', '--all') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
            Get-ChildItem -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
        }
        'pdf-comments' {
            @('--append', '-a', '--json', '--by-page', '--by-author') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
            Get-ChildItem -Filter "*.pdf" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
        }
        'grammar' {
            @('--learn', '--forget', '--list', '--rules', '--no-scientific', '--severity') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'spelling' {
            @('--british', '--learn', '--learn-project', '--list') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'sync' {
            Get-ChildItem -Filter "*.docx" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
            Get-ChildItem -Filter "*.pdf" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -like "$currentWord*") {
                    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                }
            }
        }
        'archive' {
            @('--by', '--dry-run') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'backup' {
            @('--name', '--output') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'todo' {
            @('--by-author') | Where-Object { $_ -like "$currentWord*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        default {
            # Default file completion for most commands that take files
            if (-not $currentWord.StartsWith('-')) {
                Get-ChildItem -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
                    if ($_.Name -like "$currentWord*") {
                        [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                    }
                }
                Get-ChildItem -Filter "*.docx" -ErrorAction SilentlyContinue | ForEach-Object {
                    if ($_.Name -like "$currentWord*") {
                        [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.Name)
                    }
                }
            }
        }
    }
}
