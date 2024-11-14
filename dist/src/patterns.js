"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilePatterns = void 0;
exports.FilePatterns = {
    dependency: {
        patterns: [
            // Package managers
            'package.json',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            'composer.json',
            'Gemfile',
            'requirements.txt',
            'poetry.lock',
            'go.mod',
            'cargo.toml',
            // Container files
            'Dockerfile*',
            'docker-compose*.yml',
            'docker-compose*.yaml',
            // CI/CD
            '.github/workflows/*.yml',
            '.github/workflows/*.yaml',
            '.gitlab-ci.yml',
            'azure-pipelines.yml',
            'jenkins*.groovy',
            // Infrastructure
            'terraform*.tf',
            'serverless*.yml',
            'kubernetes/*.yml',
            'helm/*.yaml',
        ],
        fileTypes: ['.yml', '.yaml', '.json', '.tf', '.toml', '.lock']
    },
    migration: {
        patterns: [
            // SQL migrations
            '**/migrations/*.sql',
            '**/migrate/*.sql',
            '**/db/migrate/*.rb',
            '**/alembic/versions/*.py',
            '**/flyway/sql/*.sql',
            '**/liquibase/*.xml',
            '**/changelog/*.sql',
            // NoSQL migrations
            '**/migrations/*.js',
            '**/migrations/*.ts',
            '**/migrate/*.js',
            '**/schemas/*.js',
            '**/models/*.js',
            // Database schemas
            'schema.rb',
            'structure.sql',
            '**/*.hcl',
            '**/*.prisma',
            '**/typeorm/*.ts',
        ],
        fileTypes: ['.sql', '.rb', '.py', '.js', '.ts', '.xml', '.prisma', '.hcl']
    }
};
//# sourceMappingURL=patterns.js.map