import antfu from '@antfu/eslint-config'

export default antfu({
    stylistic: {
        indent: 4,
    },
    ignores: ['.github', '*.yaml'],
    yaml: false,
    jsonc: false,
    regexp: false,
    rules: {
        'node/prefer-global/process': ['off', 'always'],
        'ts/consistent-type-definitions': ['off', 'type'],
        'style/member-delimiter-style': ['off', 'always'],
    },
})
