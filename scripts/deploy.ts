import { runWranglerDeploy } from '@wesdizzle/app-kit/scripts';

runWranglerDeploy({
  rootDir: process.cwd(),
  appLabel: 'collection-tracker',
  secretsToUpload: [
    'SESSION_SECRET',
    'ADMIN_KEY',
    'ADMIN_EMAIL',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'BESTBUY_API_KEY',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'APP_NAME',
    'APP_SHORT_NAME',
    'APP_TAGLINE',
    'APP_AUTHOR',
    'APP_REPO_URL',
  ],
});
