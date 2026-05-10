const baseEnv = {
  TRENCHES_SCAN_ONCE: "false",
  TRENCHES_EXECUTE: "false",
};

module.exports = {
  apps: [
    {
      name: "trenches-scan",
      script: "src/index.js",
      args: "scan",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: baseEnv,
    },
    {
      name: "trenches-paper",
      script: "src/index.js",
      args: "paper",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: baseEnv,
    },
  ],
};
