import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const isDev = process.env.APP_VARIANT === 'development';
  
  return {
    ...config,
    name: isDev ? `${config.name || 'iota'} (Dev)` : (config.name || 'iota'),
    slug: config.slug || 'iota',
    android: {
      ...config.android,
      package: isDev ? `${config.android?.package || 'com.iota.app'}.dev` : (config.android?.package || 'com.iota.app'),
    },
    ios: {
      ...config.ios,
      bundleIdentifier: isDev ? `${config.ios?.bundleIdentifier || 'com.iota.app'}.dev` : (config.ios?.bundleIdentifier || 'com.iota.app'),
    },
  };
};
