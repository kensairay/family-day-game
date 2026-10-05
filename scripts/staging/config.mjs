export function stagingTemplate(config) {
 const bindings = config.durable_objects?.bindings;
 const allowed = new Set(['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'assets', 'durable_objects', 'migrations', 'd1_databases', 'vars']);
 const allowedVars = new Set(['DEPLOYMENT_ENV', 'PUBLIC_DEPLOYMENT', 'TURNSTILE_MODE', 'STAGING_HOSTNAME', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET']);
 if (config.name !== 'family-day-game-staging' || config.main !== 'apps/worker/src/index.ts' || config.assets?.directory !== 'apps/web/build'
  || Object.keys(config).some(key => !allowed.has(key)) || Object.keys(config.vars ?? {}).some(key => !allowedVars.has(key))
  || config.workers_dev !== true || config.preview_urls !== false || config.routes || config.route || config.services || config.env
  || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB' || config.d1_databases[0].database_name !== 'family-day-game-staging'
  || bindings?.length !== 2 || !bindings.every(binding => !binding.script_name)
  || !bindings.some(binding => binding.name === 'ROOMS' && binding.class_name === 'GameRoom')
  || !bindings.some(binding => binding.name === 'DIRECTORY' && binding.class_name === 'RoomDirectory')
  || config.vars?.DEPLOYMENT_ENV !== 'staging' || config.vars.PUBLIC_DEPLOYMENT !== 'true' || config.vars.TURNSTILE_MODE !== 'test'
  || config.vars.TURNSTILE_SITE_KEY !== '1x00000000000000000000AA' || config.vars.TURNSTILE_SECRET !== '1x0000000000000000000000000000000AA') throw new Error('只允許獨立 Staging Worker／D1／DO，禁止正式路由或共用正式物件');
 return structuredClone(config);
}
