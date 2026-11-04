import { setTooltip } from 'obsidian';
import type { SyncProgress } from '../sync/SyncEngine';
import type { SyncRunSummary } from '../sync/SyncState';
import { formatSyncSummary, statusBarText } from './summary';
import { moment } from '../utils/moment';

/**
 * Unobtrusive status bar indicator (desktop only; Obsidian has no status bar
 * on mobile). Shows real progress counts while syncing and the outcome of the
 * last run afterwards.
 */
export class StatusBar {
	constructor(private readonly el: HTMLElement) {
		el.addClass('fieldy-status');
	}

	setVisible(visible: boolean): void {
		this.el.toggle(visible);
	}

	start(): void {
		this.el.addClass('is-syncing');
		this.el.setText('Fieldy: starting sync…');
		setTooltip(this.el, 'Fieldy sync in progress');
	}

	progress(progress: SyncProgress): void {
		this.el.addClass('is-syncing');
		if (progress.phase === 'listing') {
			this.el.setText(progress.done > 0 ? `Fieldy: found ${progress.done} conversations…` : 'Fieldy: checking conversations…');
		} else if (progress.phase === 'processing') {
			this.el.setText(`Fieldy: syncing ${Math.min(progress.done + 1, progress.total)}/${progress.total}`);
		} else {
			this.el.setText('Fieldy: saving…');
		}
	}

	finish(summary: SyncRunSummary | null): void {
		this.el.removeClass('is-syncing');
		this.el.toggleClass('has-problem', !!summary && (summary.fatal !== null || summary.counts.failed > 0));
		this.el.setText(statusBarText(summary, (iso) => moment(iso).format('HH:mm')));
		setTooltip(this.el, summary ? `${formatSyncSummary(summary)}\nClick to sync now.` : 'Click to sync with Fieldy.');
	}
}
