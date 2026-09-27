import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { secretScrubLines } from '../src/sessions/launchConfig.ts';

/** Runs the scrub lines in sh with `env`, and returns the variables left. */
function scrub(env: Record<string, string>, pass: string[] = []): Record<string, string> {
  const script = [...secretScrubLines(pass), 'env'].join('\n');
  const output = execFileSync('/bin/sh', ['-c', script], { env: { PATH: process.env.PATH!, ...env } });
  return Object.fromEntries(
    output
      .toString()
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

describe('desk environment', () => {
  it('keeps secrets out of the session, except Claude Code credentials and chosen ones', () => {
    const left = scrub(
      {
        HOME: '/home/me',
        LANG: 'en_US.UTF-8',
        GITHUB_TOKEN: 'ghp_x',
        OPENAI_API_KEY: 'sk-x',
        AWS_SECRET_ACCESS_KEY: 'aws',
        DB_PASSWORD: 'pw',
        npm_config__authtoken: 'npm',
        CLAUDE_CODE_OAUTH_TOKEN: 'claude',
        ANTHROPIC_API_KEY: 'anthropic',
        WORKSPACE_DESK_TOKEN: 'desk',
        SSH_AUTH_SOCK: '/tmp/agent',
        NPM_TOKEN: 'needed',
      },
      ['NPM_TOKEN', 'not a name; rm -rf /'],
    );
    for (const name of ['GITHUB_TOKEN', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD']) {
      expect(left[name], name).toBeUndefined();
    }
    expect(left.npm_config__authtoken).toBeUndefined();
    expect(left).toMatchObject({
      HOME: '/home/me',
      LANG: 'en_US.UTF-8',
      CLAUDE_CODE_OAUTH_TOKEN: 'claude',
      ANTHROPIC_API_KEY: 'anthropic',
      WORKSPACE_DESK_TOKEN: 'desk',
      SSH_AUTH_SOCK: '/tmp/agent',
      NPM_TOKEN: 'needed',
    });
  });
});
