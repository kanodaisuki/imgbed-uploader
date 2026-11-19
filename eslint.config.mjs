import tseslint from 'typescript-eslint';

export default tseslint.config(
  // spike/ 是 T0 一次性验证代码（T9 后删除），不纳入 lint
  { ignores: ['dist/**', 'out/**', '.vscode-test/**', 'spike/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],
      curly: 'warn',
      eqeqeq: 'warn',
    },
  },
  {
    // 类型感知规则只作用于 TS 源码（esbuild.js 等配置文件不在 tsconfig 项目内）
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/only-throw-error': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },
  {
    // esbuild.js 是 CJS 构建脚本，require 是正确用法
    files: ['esbuild.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
