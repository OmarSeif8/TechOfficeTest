module.exports = {
  apps: [{
    name: "techoffice",
    script: "node_modules/.bin/next",
    args: "dev -p 3000",
    cwd: "/home/z/my-project",
    autorestart: true,
    max_restarts: 100,
    restart_delay: 2000,
    env: {
      NODE_ENV: "development",
    },
  }],
};
