export function ok(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

export function created(res, payload = {}) {
  return ok(res, payload, 201);
}
