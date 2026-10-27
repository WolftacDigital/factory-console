import type { Snapshot } from "../types";

export function QueueBoard({ snap }: { snap: Snapshot }) {
  const board = snap.board;
  return (
    <section className="panel primary" aria-labelledby="board-h">
      <h2 id="board-h">QUEUE BOARD <span className="label">Factory Queue by conveyor state</span></h2>
      {!board ? (
        <p className="empty">Linear not connected: {snap.sources.linear.reason ?? "unknown"}</p>
      ) : (
        <div className="board">
          {board.columns.map((c) => (
            <div className="column" key={c.name} role="region" aria-label={`${c.label}, ${c.cards.length} issues`}>
              <h3><span>{c.label}</span><span className="data">{c.cards.length}</span></h3>
              {c.cards.length === 0 ? (
                <p className="empty">Nothing here</p>
              ) : (
                <ul>
                  {c.cards.map((card) => (
                    <li className="card" key={card.identifier}>
                      <a className="card-link" href={card.url || undefined} target="_blank" rel="noopener noreferrer">
                        <span className="card-id">{card.identifier}</span>
                        <span className="card-title">{card.title}</span>
                      </a>
                      <span className="card-meta">
                        <span className="tag">lane: {card.lane}</span>
                        <span>{card.assignee ? `assignee: ${card.assignee}` : card.delegate ? `delegate: ${card.delegate}` : "unassigned"}</span>
                        {card.assignee && card.delegate && <span>delegate: {card.delegate}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
