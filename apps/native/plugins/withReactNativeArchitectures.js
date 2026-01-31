const { withGradleProperties } = require("expo/config-plugins");

/**
 * Config plugin to set reactNativeArchitectures in gradle.properties.
 * Prevents EAS prebuild from resetting to all architectures.
 */
function withReactNativeArchitectures(config, architectures = "arm64-v8a,x86_64") {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    // Update or add reactNativeArchitectures
    const archIndex = props.findIndex(
      (p) => p.type === "property" && p.key === "reactNativeArchitectures",
    );
    const archProp = { type: "property", key: "reactNativeArchitectures", value: architectures };
    if (archIndex >= 0) {
      props[archIndex] = archProp;
    } else {
      props.push(archProp);
    }

    return config;
  });
}

module.exports = withReactNativeArchitectures;
