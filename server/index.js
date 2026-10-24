let appPromise = null;
let startupError = null;

async function getApp() {
  if (startupError) throw startupError;
  if (!appPromise) {
    appPromise = import('./dist/index.js')
      .then(m => m.default)
      .catch(err => {
        startupError = err;
        throw err;
      });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Backend startup crashed on Vercel',
      message: err.message,
      stack: err.stack,
    }));
  }
}
