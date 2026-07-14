import type pg from "pg";

export type FixtureRefs = {
  outletId: string;
  storeId: string;
  businessDate: string;
  orderId: string;
  clusterOutletId: string; // an outlet inside the cluster_manager's group, for cross-checks
  users: {
    cashier: string;
    outletManager: string;
    clusterManager: string;
    orgOwner: string;
  };
  gstRegistrationId: string;
  terminalId: string;
  taxClassId: string;
};

/** Resolves real IDs out of the already-generated bench fixture — nothing here is fixture-generation, only lookup, run as the superuser so it sees everything regardless of RLS. */
export async function resolveFixtureRefs(client: pg.Client): Promise<FixtureRefs> {
  const outlet = await client.query<{ id: string }>(
    `select id from outlets where name = 'Bench Outlet 1'`,
  );
  const outletId = outlet.rows[0]!.id;

  const store = await client.query<{ id: string }>(`select id from stores where outlet_id = $1 limit 1`, [outletId]);
  const storeId = store.rows[0]!.id;

  const order = await client.query<{ id: string; business_date: string }>(
    `select id, business_date from orders where outlet_id = $1 order by created_at desc limit 1`,
    [outletId],
  );
  const orderId = order.rows[0]!.id;
  const businessDate = order.rows[0]!.business_date;

  const terminal = await client.query<{ id: string }>(`select id from terminals where outlet_id = $1 limit 1`, [outletId]);
  const gstReg = await client.query<{ gst_registration_id: string }>(`select gst_registration_id from outlets where id = $1`, [outletId]);
  const taxClass = await client.query<{ id: string }>(`select id from tax_classes limit 1`);

  const cashier = await client.query<{ user_id: string }>(
    `select user_id from memberships where scope_type = 'outlet' and scope_id = $1 and role = 'cashier' limit 1`,
    [outletId],
  );
  const outletManager = await client.query<{ user_id: string }>(
    `select user_id from memberships where scope_type = 'outlet' and scope_id = $1 and role = 'outlet_manager' limit 1`,
    [outletId],
  );
  const clusterMembership = await client.query<{ scope_id: string; user_id: string }>(
    `select m.scope_id, m.user_id from memberships m
     join outlet_group_members ogm on ogm.outlet_group_id = m.scope_id
     where m.role = 'cluster_manager' and ogm.outlet_id = $1 limit 1`,
    [outletId],
  );
  const orgOwner = await client.query<{ user_id: string }>(
    `select m.user_id from memberships m join outlets o on o.org_id = m.scope_id
     where m.role = 'org_owner' and o.id = $1 limit 1`,
    [outletId],
  );

  return {
    outletId,
    storeId,
    businessDate,
    orderId,
    clusterOutletId: clusterMembership.rows[0]?.scope_id ?? outletId,
    users: {
      cashier: cashier.rows[0]!.user_id,
      outletManager: outletManager.rows[0]!.user_id,
      clusterManager: clusterMembership.rows[0]!.user_id,
      orgOwner: orgOwner.rows[0]!.user_id,
    },
    gstRegistrationId: gstReg.rows[0]!.gst_registration_id,
    terminalId: terminal.rows[0]!.id,
    taxClassId: taxClass.rows[0]!.id,
  };
}
