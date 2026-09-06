module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo automatically adds react-native-worklets/plugin
    // (required by react-native-reanimated 4). It must be the preset for
    // Metro so worklets get their __initData attached at build time.
    presets: ['babel-preset-expo'],
  };
};
