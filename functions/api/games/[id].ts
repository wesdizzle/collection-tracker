interface Env {
  DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
      const id = context.params.id;
      const query = `
          SELECT g.*, p.brand, p.launch_date as platform_launch_date 
          FROM games g 
          LEFT JOIN platforms p ON g.platform = p.name 
          WHERE g.id = ?
      `;
      const stmt = context.env.DB.prepare(query).bind(id);
      const game = await stmt.first();
      
      if (!game) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json(game);
  } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
  }
};
