import { applyAndroidFullscreen } from "./androidFullscreen";

describe("applyAndroidFullscreen", () => {
  it("hides the Android navigation bar in overlay swipe mode", async () => {
    const navigationBar = {
      setBehaviorAsync: jest.fn().mockResolvedValue(undefined),
      setVisibilityAsync: jest.fn().mockResolvedValue(undefined),
    };

    await applyAndroidFullscreen("android", navigationBar);

    expect(navigationBar.setBehaviorAsync).toHaveBeenCalledWith("overlay-swipe");
    expect(navigationBar.setVisibilityAsync).toHaveBeenCalledWith("hidden");
  });

  it("does nothing outside Android", async () => {
    const navigationBar = {
      setBehaviorAsync: jest.fn().mockResolvedValue(undefined),
      setVisibilityAsync: jest.fn().mockResolvedValue(undefined),
    };

    await applyAndroidFullscreen("ios", navigationBar);

    expect(navigationBar.setBehaviorAsync).not.toHaveBeenCalled();
    expect(navigationBar.setVisibilityAsync).not.toHaveBeenCalled();
  });
});
