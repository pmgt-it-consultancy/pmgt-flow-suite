const { withGradleProperties } = require("expo/config-plugins");

/**
 * Config plugin to set reactNativeArchitectures in gradle.properties.
 * Prevents EAS prebuild from resetting to all architectures.
 */
function withReactNativeArchitectures(config, architectures = "arm64-v8a,x86_64") {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const setProperty = (key, value) => {
      const index = props.findIndex((p) => p.type === "property" && p.key === key);
      const prop = { type: "property", key, value };
      if (index >= 0) {
        props[index] = prop;
      } else {
        props.push(prop);
      }
    };

    setProperty("reactNativeArchitectures", architectures);
    setProperty("android.injected.build.abi", architectures);

    return config;
  });
}

module.exports = withReactNativeArchitectures;
