module.exports = {
  apps: [
    {
      name: "dev_nms",
      script: "build/index.js",
      exec_mode: "fork",
      env_file: ".env",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
    },
  ],
};
