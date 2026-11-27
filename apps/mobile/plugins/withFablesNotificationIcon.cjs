const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withFablesNotificationIcon(config) {
  return withDangerousMod(config, [
    "android",
    (nextConfig) => {
      const values = path.join(
        nextConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "values",
      );
      fs.mkdirSync(values, { recursive: true });
      // The app resource overrides the native agent notification module's default drawable.
      fs.writeFileSync(
        path.join(values, "fables_notification_icon.xml"),
        '<resources><item name="agent_activity_mark" type="drawable">@drawable/notification_icon</item></resources>\n',
      );
      return nextConfig;
    },
  ]);
};
