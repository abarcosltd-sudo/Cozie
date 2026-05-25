export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        // Merge so we don't drop params that aren't declared in this schema
        // (e.g. when this router is mounted under another with parent params).
        req.params = { ...req.params, ...schemas.params.parse(req.params) };
      }
      if (schemas.query) {
        // Express 5 makes req.query a non-writable getter, so expose the
        // coerced version on req.validatedQuery. Use a configurable property
        // so a second pass (e.g. nested routers) can replace it without
        // throwing.
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, "validatedQuery", {
          value: parsedQuery,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
