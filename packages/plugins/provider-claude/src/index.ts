import { fileURLToPath } from 'node:url'
import { defineProviderPlugin } from '@factory/plugin-sdk'

/**
 * The claude provider. A descriptor and one call — see provider.yaml for the
 * flags, model roles and capabilities, all of which are data.
 */
export default defineProviderPlugin({
  name: '@factory/provider-claude',
  version: '0.1.0',
  // src/ -> package root, and dist/ -> package root too.
  descriptorFile: fileURLToPath(new URL('../provider.yaml', import.meta.url)),
})
