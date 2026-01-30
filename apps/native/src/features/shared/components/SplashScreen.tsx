import { useEffect } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const LOGO_WIDTH = Math.min(SCREEN_WIDTH * 0.3, 280);
const BAR_WIDTH = Math.min(SCREEN_WIDTH * 0.25, 220);

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen = ({ onFinish }: SplashScreenProps) => {
  const logoProgress = useSharedValue(0);
  const barProgress = useSharedValue(0);
  const fadeOut = useSharedValue(1);

  useEffect(() => {
    // Logo entrance
    logoProgress.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });

    // Progress bar fill
    barProgress.value = withDelay(
      600,
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
    );

    // Fade out then call onFinish
    fadeOut.value = withDelay(
      2200,
      withTiming(0, { duration: 400, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      }),
    );
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(logoProgress.value, [0, 1], [0, 1]),
    transform: [{ scale: interpolate(logoProgress.value, [0, 1], [0.85, 1]) }],
  }));

  const barFillStyle = useAnimatedStyle(() => ({
    width: `${barProgress.value * 100}%` as any,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeOut.value,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      {/* Subtle radial-like gradient via layered views */}
      <View style={styles.gradientOverlay} />

      <View style={styles.content}>
        {/* Logo */}
        <Animated.View style={[styles.logoContainer, logoStyle]}>
          <Animated.Image
            source={require("../../../../assets/logo-full.png")}
            style={{ width: LOGO_WIDTH, height: LOGO_WIDTH * 0.5 }}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Progress bar */}
        <Animated.View style={[styles.barContainer, logoStyle]}>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, barFillStyle]} />
          </View>
        </Animated.View>
      </View>

      {/* Footer */}
      <Animated.Text style={[styles.footer, logoStyle]}>PMGT IT Consultancy</Animated.Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0A1628",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    // Subtle lighter center glow
    borderRadius: 9999,
    opacity: 0.07,
    transform: [{ scaleX: 2.5 }, { scaleY: 1.2 }],
    shadowColor: "#0D87E1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 200,
    elevation: 0,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoContainer: {
    marginBottom: 32,
  },
  barContainer: {
    alignItems: "center",
  },
  barTrack: {
    width: BAR_WIDTH,
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#0D87E1",
    borderRadius: 2,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    fontFamily: "MLight",
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.3)",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
