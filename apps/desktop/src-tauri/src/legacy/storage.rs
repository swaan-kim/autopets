use crate::application::store::*;
use rusqlite::params;

impl Store {
    pub(crate) fn save_approval(&self, id: &str) -> Result<(), String> {
        let a = &self.approvals.get(id).ok_or("Unknown approval")?.view;
        self.db.execute("INSERT OR REPLACE INTO approvals(request_id,session_id,turn_id,tool_name,created_at,expires_at,status,delivery) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![a.request_id,a.session_id,a.turn_id,a.tool_name,a.created_at,a.expires_at,encode(&a.status),encode(&a.delivery)]).map_err(db_err)?;
        Ok(())
    }
}

impl Store {
    pub(crate) fn restore_approval_history(&mut self) -> Result<(), String> {
        {
            let mut stmt = self.db.prepare("SELECT request_id,session_id,turn_id,tool_name,created_at,expires_at,status,delivery FROM approvals ORDER BY created_at DESC LIMIT 200").map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, u64>(4)?,
                        r.get::<_, u64>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                    ))
                })
                .map_err(db_err)?;
            for row in rows {
                let (
                    request_id,
                    session_id,
                    turn_id,
                    tool_name,
                    created_at,
                    expires_at,
                    status,
                    delivery,
                ) = row.map_err(db_err)?;
                let mut delivery: Delivery = decode(&delivery)?;
                let prior_status: ApprovalStatus = decode(&status)?;
                let status = if prior_status == ApprovalStatus::Pending {
                    ApprovalStatus::Cancelled
                } else {
                    prior_status
                };
                if delivery == Delivery::Waiting
                    && matches!(status, ApprovalStatus::Approved | ApprovalStatus::Denied)
                {
                    delivery = Delivery::Invalidated;
                }
                self.approvals.insert(
                    request_id.clone(),
                    ApprovalRecord {
                        view: Approval {
                            request_id,
                            session_id,
                            turn_id,
                            tool_name,
                            description: String::new(),
                            details: String::new(),
                            created_at,
                            expires_at,
                            status,
                            delivery,
                        },
                        lease_until: 0,
                        live: false,
                        fingerprint: None,
                    },
                );
            }
        }
        // Every new process starts observation-only. Persisted decisions are history, never deliverable.
        self
            .db
            .execute(
                "UPDATE approvals SET status=CASE WHEN status=?1 THEN ?2 ELSE status END, delivery=CASE WHEN status IN (?3,?4) THEN ?5 ELSE delivery END WHERE delivery=?6",
                params![
                    encode(&ApprovalStatus::Pending),
                    encode(&ApprovalStatus::Cancelled),
                    encode(&ApprovalStatus::Approved),
                    encode(&ApprovalStatus::Denied),
                    encode(&Delivery::Invalidated),
                    encode(&Delivery::Waiting)
                ],
            )
            .map_err(db_err)?;
        Ok(())
    }
}
