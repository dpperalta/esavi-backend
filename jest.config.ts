import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '.',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    setupFiles: ['<rootDir>/tests/setup/env.ts'],
    globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
    },
    clearMocks: true,
    testTimeout: 30000,
    verbose: true
};

export default config;
