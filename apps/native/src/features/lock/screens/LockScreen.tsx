import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Text as RNText, useWindowDimensions } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { Button, Text } from "../../shared/components/ui";
import { ManagerOverrideModal } from "../components/ManagerOverrideModal";
import { NumericPinPad } from "../components/NumericPinPad";
import { useLockStore } from "../stores/useLockStore";

interface LockScreenProps {
  navigation: any;
}

export function LockScreen({ navigation }: LockScreenProps) {
  const { user } = useAuth();
  const { height } = useWindowDimensions();
  const lockedUserName = useLockStore((state) => state.lockedUserName);
  const lockedUserRole = useLockStore((state) => state.lockedUserRole);
  const lockedAt = useLockStore((state) => state.lockedAt);
  const lockedUserId = useLockStore((state) => state.lockedUserId);
  const routeHistory = useLockStore((state) => state.routeHistory);
  const cooldownUntil = useLockStore((state) => state.cooldownUntil);
  const unlock = useLockStore((state) => state.unlock);
  const recordFailedAttempt = useLockStore((state) => state.recordFailedAttempt);
  const resetFailedAttempts = useLockStore((state) => state.resetFailedAttempts);
  const isCoolingDown = useLockStore((state) => state.isCoolingDown);

  const [pin, setPin] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOverrideVerifying, setIsOverrideVerifying] = useState(false);
  const [showManagerModal, setShowManagerModal] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const screenUnlock = useAction(api.screenLockActions.screenUnlock);
  const screenUnlockOverride = useAction(api.screenLockActions.screenUnlockOverride);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }

    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining <= 0) {
        resetFailedAttempts();
      }
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1_000);
    return () => clearInterval(interval);
  }, [cooldownUntil, resetFailedAttempts]);

  const shakePin = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const finishUnlock = useCallback(() => {
    unlock();
    const restoredRoutes =
      routeHistory.length > 0
        ? routeHistory.map((route) => ({
            name: route.name,
            ...(route.params ? { params: route.params } : {}),
          }))
        : [{ name: "HomeScreen" }];

    navigation.reset({
      index: restoredRoutes.length - 1,
      routes: restoredRoutes,
    });
  }, [navigation, routeHistory, unlock]);

  const handleUnlock = useCallback(async () => {
    if (!pin || !lockedUserId || !user?.storeId || isVerifying) {
      return;
    }

    if (isCoolingDown()) {
      return;
    }

    setIsVerifying(true);
    try {
      const result = await screenUnlock({
        userId: lockedUserId as Id<"users">,
        pin,
        storeId: user.storeId,
      });

      if (result.success) {
        finishUnlock();
        return;
      }

      shakePin();
      setPin("");
      const cooled = recordFailedAttempt();
      if (cooled) {
        Alert.alert("Too Many Attempts", "Please wait 30 seconds before trying again.");
      } else if (result.error) {
        Alert.alert("Invalid PIN", result.error);
      }
    } catch {
      Alert.alert("Error", "Failed to verify PIN. Please try again.");
      setPin("");
    } finally {
      setIsVerifying(false);
    }
  }, [
    finishUnlock,
    isCoolingDown,
    isVerifying,
    lockedUserId,
    pin,
    recordFailedAttempt,
    screenUnlock,
    shakePin,
    user?.storeId,
  ]);

  const handleManagerOverride = useCallback(
    async (managerId: Id<"users">, managerPin: string) => {
      if (!lockedUserId || !user?.storeId) {
        return;
      }

      setIsOverrideVerifying(true);
      try {
        const result = await screenUnlockOverride({
          lockedUserId: lockedUserId as Id<"users">,
          managerId,
          managerPin,
          storeId: user.storeId,
        });

        if (result.success) {
          setShowManagerModal(false);
          finishUnlock();
          return;
        }

        Alert.alert("Manager Override Failed", result.error || "Manager PIN is incorrect.");
      } catch {
        Alert.alert("Error", "Failed to verify manager PIN.");
      } finally {
        setIsOverrideVerifying(false);
      }
    },
    [finishUnlock, lockedUserId, screenUnlockOverride, user?.storeId],
  );

  const lockedSince = lockedAt
    ? new Date(lockedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const timeString = currentTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateString = currentTime.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const cooling = isCoolingDown();
  const compactScale = height < 820 ? 0.76 : height < 900 ? 0.88 : 1;

  return (
    <YStack
      flex={1}
      backgroundColor="#F9FAFB"
      alignItems="center"
      justifyContent="center"
      paddingHorizontal={24}
    >
      <RNText
        style={{
          fontSize: Math.round(64 * compactScale),
          lineHeight: Math.round(76 * compactScale),
          fontWeight: "700",
          color: "#111827",
          letterSpacing: -1.5,
          paddingTop: Math.max(4, Math.round(6 * compactScale)),
          includeFontPadding: false,
          textAlign: "center",
        }}
      >
        {timeString}
      </RNText>
      <RNText
        style={{
          fontSize: Math.max(15, Math.round(18 * compactScale)),
          color: "#6B7280",
          marginTop: Math.max(4, Math.round(6 * compactScale)),
          includeFontPadding: false,
          textAlign: "center",
        }}
      >
        {dateString}
      </RNText>

      <YStack
        width={Math.round(104 * compactScale)}
        height={Math.round(104 * compactScale)}
        borderRadius={Math.round(52 * compactScale)}
        backgroundColor="#DBEAFE"
        alignItems="center"
        justifyContent="center"
        marginTop={Math.round(38 * compactScale)}
        marginBottom={Math.round(24 * compactScale)}
      >
        <Ionicons name="lock-closed" size={Math.round(42 * compactScale)} color="#0D87E1" />
      </YStack>

      <Text
        style={{
          fontSize: Math.max(22, Math.round(28 * compactScale)),
          fontWeight: "700",
          color: "#111827",
          textAlign: "center",
        }}
      >
        {lockedUserName ?? "User"}
      </Text>
      <Text
        style={{
          fontSize: Math.max(15, Math.round(18 * compactScale)),
          color: "#6B7280",
          marginTop: Math.max(4, Math.round(6 * compactScale)),
          textAlign: "center",
        }}
      >
        {lockedUserRole ?? "Staff"}
        {lockedSince ? ` \u2022 Locked since ${lockedSince}` : ""}
      </Text>

      <Animated.View
        style={{
          marginTop: Math.round(34 * compactScale),
          transform: [{ translateX: shakeAnim }],
        }}
      >
        <NumericPinPad
          pin={pin}
          onPinChange={setPin}
          disabled={isVerifying || cooling}
          scale={compactScale}
        />
      </Animated.View>

      {cooling && cooldownSeconds > 0 && (
        <Text
          style={{
            fontSize: Math.max(15, Math.round(18 * compactScale)),
            color: "#DC2626",
            fontWeight: "600",
            marginTop: Math.round(16 * compactScale),
          }}
        >
          Try again in {cooldownSeconds}s
        </Text>
      )}

      <Button
        variant="primary"
        size="lg"
        onPress={handleUnlock}
        disabled={!pin || isVerifying || cooling}
        style={{
          marginTop: Math.round(30 * compactScale),
          minWidth: Math.round(320 * compactScale),
          minHeight: Math.round(64 * compactScale),
          borderRadius: 16,
          opacity: !pin || isVerifying || cooling ? 0.6 : 1,
        }}
      >
        {isVerifying ? "Verifying..." : "Unlock"}
      </Button>

      <Pressable onPress={() => setShowManagerModal(true)}>
        <Text
          style={{
            fontSize: Math.max(15, Math.round(18 * compactScale)),
            color: "#0D87E1",
            marginTop: Math.round(22 * compactScale),
            fontWeight: "600",
          }}
        >
          Manager Override
        </Text>
      </Pressable>

      <ManagerOverrideModal
        visible={showManagerModal}
        onClose={() => setShowManagerModal(false)}
        onSubmit={handleManagerOverride}
        isVerifying={isOverrideVerifying}
      />
    </YStack>
  );
}
