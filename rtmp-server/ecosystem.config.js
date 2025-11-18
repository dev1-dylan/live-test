module.exports = {
  apps: [
    {
      name: "dev_nms",
      script: "build/index.js",
      interpreter: "node",
      args: "",
      instances: 1,
      max_memory_restart: "1G",
      autorestart: true,
      exec_mode: "fork",
      watch: false,
      env_file: ".env",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
    },
  ],
};
