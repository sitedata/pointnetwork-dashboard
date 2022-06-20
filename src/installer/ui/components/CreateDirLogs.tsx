import { useEffect, useState } from 'react'
// MUI
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
// Icons
import DownloadIcon from '@mui/icons-material/Download'
import DownloadDoneIcon from '@mui/icons-material/DownloadDone'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
// Types
import { GenericProgressLog } from '../../../@types/generic'
import { InstallerChannelsEnum } from '../../../@types/ipc_channels'

const CreateDirLogs = ({
  title,
  channel,
}: {
  title: 'Create Directoires' | 'Clone Repositories'
  // eslint-disable-next-line camelcase
  channel: InstallerChannelsEnum.clone_repos | InstallerChannelsEnum.create_dirs
}) => {
  const [progress, setProgress] = useState<GenericProgressLog>({
    started: false,
    done: false,
    progress: 0,
    log: 'Waiting...',
  })

  useEffect(() => {
    window.Installer.on(channel, (log: string) => {
      const parsed: GenericProgressLog = JSON.parse(log)
      setProgress(parsed)
    })
  }, [])

  return (
    <Grid container p={1}>
      <Grid item xs={9}>
        <Typography>{title}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.6 }}>
          {progress.log}
        </Typography>
      </Grid>
      <Grid item xs={3} display="flex">
        <Box position="relative" mr={1.25}>
          <CircularProgress
            variant={
              progress.started && !progress.progress
                ? 'indeterminate'
                : 'determinate'
            }
            value={Number(progress.progress)}
            size={32}
          />
          {channel === InstallerChannelsEnum.create_dirs ? (
            <Box position="absolute" top={6} left={6}>
              {progress.done ? (
                <FolderIcon fontSize="small" />
              ) : (
                <FolderOpenIcon fontSize="small" />
              )}
            </Box>
          ) : (
            <Box position="absolute" top={6} left={6}>
              {progress.done ? (
                <DownloadDoneIcon fontSize="small" />
              ) : (
                <DownloadIcon fontSize="small" />
              )}
            </Box>
          )}
        </Box>
      </Grid>
    </Grid>
  )
}

export default CreateDirLogs
