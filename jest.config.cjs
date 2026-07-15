/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/packages/**/*.test.ts"],
};
