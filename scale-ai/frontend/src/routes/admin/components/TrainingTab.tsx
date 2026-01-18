/**
 * TrainingTab component - Model training and activation interface.
 * Allows admins to start training jobs and manage trained models.
 * Displays training job status with auto-refresh and trained models list.
 * @module routes/admin/components/TrainingTab
 */

import { useState, useEffect, useCallback } from 'react'
import { getTrainingJobs, cancelTrainingJob, type Model, type TrainingJob } from '../../../services/api'

/**
 * Training configuration options.
 */
export interface TrainingConfig {
  epochs: number
  batch_size: number
  learning_rate: number
}

/**
 * Per-shape drawing count.
 */
interface ShapeCount {
  name: string
  count: number
}

/**
 * Props for the TrainingTab component.
 */
interface TrainingTabProps {
  /** Array of trained models */
  models: Model[]
  /** Total number of drawings available for training */
  totalDrawings: number
  /** Drawings per shape breakdown */
  drawingsPerShape: ShapeCount[]
  /** Whether a training job is currently being started */
  trainingInProgress: boolean
  /** Callback to start a new training job with config */
  onStartTraining: (config: TrainingConfig) => void
  /** Callback to activate a specific model */
  onActivateModel: (modelId: string) => void
  /** Callback to refresh data after job completes */
  onRefresh?: () => void
}

/** Minimum number of drawings required to start training */
const MIN_DRAWINGS_FOR_TRAINING = 10

/** Auto-refresh interval for active jobs (in milliseconds) */
const REFRESH_INTERVAL = 3000

/** Default training configuration */
const DEFAULT_CONFIG: TrainingConfig = {
  epochs: 25,
  batch_size: 32,
  learning_rate: 0.001,
}

/**
 * Training management tab for the admin dashboard.
 * Provides controls to start training and manage trained models.
 * Shows training job status with auto-refresh for active jobs.
 *
 * @param props - Component props
 */
export function TrainingTab({
  models,
  totalDrawings,
  drawingsPerShape,
  trainingInProgress,
  onStartTraining,
  onActivateModel,
  onRefresh,
}: TrainingTabProps) {
  const [jobs, setJobs] = useState<TrainingJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)

  // Training config state
  const [epochs, setEpochs] = useState(DEFAULT_CONFIG.epochs)
  const [batchSize, setBatchSize] = useState(DEFAULT_CONFIG.batch_size)
  const [learningRate, setLearningRate] = useState(DEFAULT_CONFIG.learning_rate)

  const canTrain = totalDrawings >= MIN_DRAWINGS_FOR_TRAINING

  /**
   * Fetches training jobs from the API.
   */
  const loadJobs = useCallback(async () => {
    try {
      const jobsData = await getTrainingJobs()
      setJobs(jobsData)
      setJobsError(null)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      setJobsLoading(false)
    }
  }, [])

  // Load jobs on mount
  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // Check if there are any active jobs (pending, queued, or running)
  const hasActiveJobs = jobs.some((job) =>
    ['pending', 'queued', 'running'].includes(job.status)
  )

  // Auto-refresh while jobs are active
  useEffect(() => {
    if (!hasActiveJobs) return

    const interval = setInterval(() => {
      loadJobs()
      // Also refresh parent data to get new models when job completes
      onRefresh?.()
    }, REFRESH_INTERVAL)

    return () => clearInterval(interval)
  }, [hasActiveJobs, loadJobs, onRefresh])

  // Refresh jobs when training is started
  useEffect(() => {
    if (!trainingInProgress) {
      // Small delay to ensure job is created
      setTimeout(loadJobs, 500)
    }
  }, [trainingInProgress, loadJobs])

  /**
   * Cancels a training job.
   *
   * @param jobId - The job ID to cancel
   */
  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelTrainingJob(jobId)
      // Refresh jobs list
      loadJobs()
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to cancel job')
    }
  }

  /**
   * Starts training with current config.
   */
  const handleStartTraining = () => {
    onStartTraining({
      epochs,
      batch_size: batchSize,
      learning_rate: learningRate,
    })
  }

  return (
    <div className="training-section">
      <div className="training-header">
        <h2>Model Training</h2>
      </div>

      {/* Training Data Overview */}
      <div className="training-data-overview card">
        <h3>Available Training Data</h3>
        <div className="data-stats">
          <div className="total-stat">
            <span className="stat-value">{totalDrawings}</span>
            <span className="stat-label">Total Drawings</span>
          </div>
          <div className="shape-stats">
            {drawingsPerShape.map((shape) => (
              <div key={shape.name} className="shape-stat">
                <span className="shape-name">{shape.name}</span>
                <span className="shape-count">{shape.count}</span>
              </div>
            ))}
          </div>
        </div>
        {!canTrain && (
          <TrainingWarning
            currentCount={totalDrawings}
            requiredCount={MIN_DRAWINGS_FOR_TRAINING}
          />
        )}
      </div>

      {/* Training Configuration */}
      <div className="training-config card">
        <h3>Training Configuration</h3>
        <div className="config-form">
          <div className="config-row">
            <div className="config-field">
              <label htmlFor="epochs">Epochs</label>
              <input
                id="epochs"
                type="number"
                min="1"
                max="100"
                value={epochs}
                onChange={(e) => setEpochs(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={hasActiveJobs}
              />
              <span className="field-hint">More epochs = better accuracy, longer training</span>
            </div>
            <div className="config-field">
              <label htmlFor="batchSize">Batch Size</label>
              <input
                id="batchSize"
                type="number"
                min="8"
                max="128"
                step="8"
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(8, parseInt(e.target.value) || 32))}
                disabled={hasActiveJobs}
              />
              <span className="field-hint">Smaller = slower but more stable</span>
            </div>
            <div className="config-field">
              <label htmlFor="learningRate">Learning Rate</label>
              <select
                id="learningRate"
                value={learningRate}
                onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                disabled={hasActiveJobs}
              >
                <option value="0.01">0.01 (Fast)</option>
                <option value="0.001">0.001 (Default)</option>
                <option value="0.0005">0.0005 (Slow)</option>
                <option value="0.0001">0.0001 (Very Slow)</option>
              </select>
              <span className="field-hint">Lower = more precise but slower</span>
            </div>
          </div>
          <div className="config-actions">
            <button
              className="train-btn"
              onClick={handleStartTraining}
              disabled={trainingInProgress || !canTrain || hasActiveJobs}
            >
              {trainingInProgress
                ? 'Starting...'
                : hasActiveJobs
                  ? 'Training in Progress...'
                  : `Start Training (${epochs} epochs)`}
            </button>
          </div>
        </div>
      </div>

      <JobsSection
        jobs={jobs}
        loading={jobsLoading}
        error={jobsError}
        onCancelJob={handleCancelJob}
      />

      <ModelsTable models={models} onActivate={onActivateModel} />
    </div>
  )
}

/**
 * Props for the JobsSection component.
 */
interface JobsSectionProps {
  /** Array of training jobs */
  jobs: TrainingJob[]
  /** Whether jobs are loading */
  loading: boolean
  /** Error message if loading failed */
  error: string | null
  /** Callback to cancel a job */
  onCancelJob: (jobId: string) => void
}

/**
 * Section displaying training jobs with their status.
 *
 * @param props - Component props
 */
function JobsSection({ jobs, loading, error, onCancelJob }: JobsSectionProps) {
  if (loading) {
    return (
      <div className="jobs-section">
        <h3>Training Jobs</h3>
        <p className="loading-text">Loading jobs...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="jobs-section">
        <h3>Training Jobs</h3>
        <p className="error-text">{error}</p>
      </div>
    )
  }

  return (
    <div className="jobs-section">
      <h3>Training Jobs</h3>
      {jobs.length === 0 ? (
        <p className="empty">No training jobs yet. Click "Start Training" to begin.</p>
      ) : (
        <div className="jobs-list">
          {jobs.slice(0, 10).map((job) => (
            <JobCard key={job.id} job={job} onCancel={() => onCancelJob(job.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Props for the JobCard component.
 */
interface JobCardProps {
  /** The training job to display */
  job: TrainingJob
  /** Callback to cancel this job */
  onCancel: () => void
}

/**
 * Card displaying a single training job with status.
 *
 * @param props - Component props
 */
function JobCard({ job, onCancel }: JobCardProps) {
  const statusInfo = getStatusInfo(job.status)
  const canCancel = ['pending', 'queued', 'running'].includes(job.status)

  return (
    <div className={`job-card status-${job.status}`}>
      <div className="job-header">
        <span className={`job-status ${job.status}`}>
          {statusInfo.icon} {statusInfo.label}
        </span>
        <div className="job-header-right">
          {canCancel && (
            <button className="cancel-btn" onClick={onCancel} title="Cancel training">
              Cancel
            </button>
          )}
          <span className="job-date">{formatDate(job.created_at)}</span>
        </div>
      </div>

      <div className="job-details">
        {job.status === 'running' && job.progress && (
          <div className="job-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(job.progress.current_epoch / job.progress.total_epochs) * 100}%`,
                }}
              />
            </div>
            <span className="progress-text">
              {formatProgressPhase(job.progress)}
            </span>
            {job.progress.train_loss !== undefined && (
              <div className="progress-metrics">
                <span>Loss: {job.progress.train_loss.toFixed(4)}</span>
                {job.progress.val_accuracy !== undefined && (
                  <span>Accuracy: {(job.progress.val_accuracy * 100).toFixed(1)}%</span>
                )}
              </div>
            )}
          </div>
        )}

        {job.status === 'running' && !job.progress && (
          <div className="job-progress">
            <div className="progress-bar">
              <div className="progress-fill running" />
            </div>
            <span className="progress-text">Training in progress...</span>
          </div>
        )}

        {job.status === 'completed' && (
          <div className="job-result">
            <div className="result-row">
              <span className="result-label">Accuracy:</span>
              <span className="result-value">
                {job.accuracy ? formatAccuracy(job.accuracy) : 'N/A'}
              </span>
            </div>
            {job.config && (
              <div className="result-config">
                {job.config.epochs && <span>Epochs: {job.config.epochs as number}</span>}
                {job.config.batch_size && <span>Batch: {job.config.batch_size as number}</span>}
              </div>
            )}
            {job.started_at && job.completed_at && (
              <div className="result-duration">
                Duration: {formatDuration(job.started_at, job.completed_at)}
              </div>
            )}
          </div>
        )}

        {job.status === 'failed' && (
          <div className="job-error">
            <span className="error-label">Error:</span>
            <span className="error-message">
              {job.error_message || 'Training failed. Check worker logs.'}
            </span>
          </div>
        )}

        {job.status === 'cancelled' && (
          <div className="job-cancelled">
            <span className="cancelled-text">Training was cancelled</span>
          </div>
        )}

        {(job.status === 'pending' || job.status === 'queued') && (
          <div className="job-waiting">
            <span className="waiting-text">Waiting for worker to pick up job...</span>
          </div>
        )}
      </div>

      {job.completed_at && (
        <div className="job-footer">
          <span className="job-completed">
            {job.status === 'cancelled' ? 'Cancelled' : 'Completed'}: {formatDate(job.completed_at)}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Formats the progress phase for display.
 *
 * @param progress - Progress object
 */
function formatProgressPhase(progress: TrainingJob['progress']): string {
  if (!progress) return 'Training...'

  switch (progress.phase) {
    case 'initializing':
      return 'Initializing...'
    case 'loading_data':
      return 'Loading training data...'
    case 'preparing_data':
      return 'Preparing datasets...'
    case 'training':
      return `Epoch ${progress.current_epoch}/${progress.total_epochs}`
    case 'saving_model':
      return 'Saving model...'
    default:
      return `${progress.phase} (${progress.current_epoch}/${progress.total_epochs})`
  }
}

/**
 * Returns status display info (icon and label) for a job status.
 *
 * @param status - Job status string
 */
function getStatusInfo(status: string): { icon: string; label: string } {
  switch (status) {
    case 'pending':
      return { icon: '⏳', label: 'Pending' }
    case 'queued':
      return { icon: '📥', label: 'Queued' }
    case 'running':
      return { icon: '⚙️', label: 'Running' }
    case 'completed':
      return { icon: '✓', label: 'Completed' }
    case 'failed':
      return { icon: '✗', label: 'Failed' }
    case 'cancelled':
      return { icon: '⊘', label: 'Cancelled' }
    default:
      return { icon: '?', label: status }
  }
}

/**
 * Formats accuracy value (handles string or number).
 *
 * @param accuracy - Accuracy value
 */
function formatAccuracy(accuracy: string | null): string {
  if (!accuracy) return 'N/A'
  const num = parseFloat(accuracy)
  if (isNaN(num)) return accuracy
  return `${(num * 100).toFixed(1)}%`
}

/**
 * Formats date as localized string.
 *
 * @param dateString - ISO date string
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString()
}

/**
 * Formats duration between two dates.
 *
 * @param startDate - ISO date string for start
 * @param endDate - ISO date string for end
 */
function formatDuration(startDate: string, endDate: string): string {
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const durationMs = end - start

  if (durationMs < 0) return 'N/A'

  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Props for the TrainingWarning component.
 */
interface TrainingWarningProps {
  /** Current number of drawings */
  currentCount: number
  /** Required number of drawings for training */
  requiredCount: number
}

/**
 * Warning message displayed when there are not enough drawings to train.
 *
 * @param props - Component props
 */
function TrainingWarning({ currentCount, requiredCount }: TrainingWarningProps) {
  return (
    <div className="training-warning">
      Need at least {requiredCount} drawings to train. Current: {currentCount}
    </div>
  )
}

/**
 * Props for the ModelsTable component.
 */
interface ModelsTableProps {
  /** Array of trained models */
  models: Model[]
  /** Callback to activate a model */
  onActivate: (modelId: string) => void
}

/**
 * Table displaying all trained models with their metrics and actions.
 * Shows version, accuracy, creation date, active status, and activate button.
 *
 * @param props - Component props
 */
function ModelsTable({ models, onActivate }: ModelsTableProps) {
  return (
    <div className="models-list">
      <h3>Trained Models</h3>
      {models.length === 0 ? (
        <p className="empty">No models trained yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Accuracy</th>
              <th>Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <ModelRow key={model.id} model={model} onActivate={onActivate} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Props for the ModelRow component.
 */
interface ModelRowProps {
  /** The model to display */
  model: Model
  /** Callback to activate this model */
  onActivate: (modelId: string) => void
}

/**
 * A single row in the models table.
 * Shows model details and an activate button for inactive models.
 *
 * @param props - Component props
 */
function ModelRow({ model, onActivate }: ModelRowProps) {
  return (
    <tr className={model.is_active ? 'active-model' : ''}>
      <td>{model.version}</td>
      <td>{(model.accuracy * 100).toFixed(1)}%</td>
      <td>{new Date(model.created_at).toLocaleDateString()}</td>
      <td>{model.is_active ? 'Active' : '-'}</td>
      <td>
        {!model.is_active && (
          <button className="activate-btn" onClick={() => onActivate(model.id)}>
            Activate
          </button>
        )}
      </td>
    </tr>
  )
}
