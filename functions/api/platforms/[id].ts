interface Env {
  DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
      const id = context.params.id;
      const query = `SELECT * FROM platforms WHERE id = ?`;
      const stmt = context.env.DB.prepare(query).bind(id);
      const platform = await stmt.first();
      
      if (!platform) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json(platform);
  } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
  }
};
