const enUiSchema = {
  settings: {
    title: 'System Settings',
    description: 'Manage the global behavior and service integrations for AFilmory.',
  },
  builder: {
    title: 'Builder Settings',
    description: 'Configure concurrency, logging, and repository sync rules for photo processing jobs.',
    sections: {
      processing: {
        title: 'Processing & Performance',
        description: 'Control concurrency, Live Photo behavior, and photo ID rules.',
        groups: {
          concurrency: {
            title: 'Concurrency Control',
            fields: {
              'default-concurrency': {
                title: 'Default concurrency',
                description: 'Maximum number of files processed in parallel per build run.',
                helper: 'Recommended: 1–2× the CPU core count.',
              },
              'worker-concurrency': {
                title: 'Worker internal concurrency',
                description: 'Maximum concurrent tasks inside each worker when cluster mode is enabled.',
              },
              'worker-count': {
                title: 'Max worker processes',
                description: 'Upper limit of worker processes when the builder runs in cluster mode.',
              },
              'worker-timeout': {
                title: 'Worker timeout (ms)',
                description: 'Time to wait before restarting an unresponsive worker process.',
              },
            },
          },
          behavior: {
            title: 'Processing Behavior',
            fields: {
              'enable-live-photo': {
                title: 'Enable Live Photo detection',
                description: 'Pair HEIC and MP4 assets to build Live Photo collections.',
                true: 'Enabled',
                false: 'Disabled',
              },
              'digest-suffix-length': {
                title: 'Digest suffix length',
                description: 'Append SHA-256 characters to photo IDs to avoid collisions. Set 0 to disable.',
              },
              'supported-formats': {
                title: 'Allowed image formats',
                description:
                  'Optional comma-separated extensions, for example: jpg,png,heic. Leave empty for no limit.',
              },
            },
          },
        },
      },
      observability: {
        title: 'Logging & Observability',
        description: 'Tune logging level, progress outputs, and cluster behavior.',
        groups: {
          progress: {
            title: 'Progress feedback',
            fields: {
              'show-progress': {
                title: 'Show terminal progress bar',
                description: 'Display live progress in the CLI.',
              },
              'show-detailed-stats': {
                title: 'Print detailed stats',
                description: 'Output elapsed time and delta statistics after a build finishes.',
              },
              'use-cluster-mode': {
                title: 'Enable cluster mode',
                description: 'Spawn multiple worker processes through Node.js Cluster on multi-core hosts.',
              },
            },
          },
          logging: {
            title: 'Logging levels',
            fields: {
              'logging-level': {
                title: 'Log level',
                description: 'Controls the verbosity of CLI output.',
                placeholder: 'Select a log level',
              },
              'logging-verbose': {
                title: 'Enable verbose mode',
                description: 'Output additional debugging logs.',
              },
              'logging-output': {
                title: 'Write log files',
                description: 'Persist build logs to disk for troubleshooting.',
              },
            },
          },
        },
      },
    },
  },
  site: {
    title: 'Site Settings',
    description: 'Configure branding, social links, and map experiences for the public site.',
    sections: {
      basic: {
        title: 'Basic information',
        description: 'Shown in the site navigation, home page title, and SEO metadata.',
        fields: {
          'site-name': {
            title: 'Site name',
            description: 'Appears in navigation and shared titles.',
            placeholder: 'Enter a site name',
          },
          'site-title': {
            title: 'Home page title',
            description: 'Used for the browser tab and SEO title.',
            placeholder: 'Enter a home title',
          },
          'site-description': {
            title: 'Site description',
            description: 'Used for site intro and search engine snippets.',
            placeholder: 'Describe your site…',
          },
          'site-url': {
            title: 'Site URL',
            description: 'Public base URL, must be an absolute URL.',
            placeholder: 'https://example.com',
          },
          'site-accent-color': {
            title: 'Accent color',
            description: 'Applied to buttons, links, and highlighted controls.',
            helper: 'Stored as a hexadecimal color without opacity.',
          },
        },
      },
      social: {
        title: 'Social & subscriptions',
        description: 'Links displayed in the site footer and about section.',
        groups: {
          channels: {
            title: 'Social channels',
            description: 'Provide full URLs or usernames shown in the social block.',
            fields: {
              twitter: {
                title: 'Twitter',
                helper: 'Supports full URLs or @username.',
              },
              github: {
                title: 'GitHub',
                helper: 'Supports full URLs or usernames.',
              },
            },
          },
        },
      },
      feed: {
        title: 'Feed integrations',
        description: 'Configure external feed providers for aggregated content.',
        groups: {
          folo: {
            title: 'Folo Challenge',
            description: 'Feed ID and User ID required for syncing Folo Challenge data.',
            fields: {
              'feed-id': {
                title: 'Feed ID',
                placeholder: 'Enter feed ID',
              },
              'user-id': {
                title: 'User ID',
                placeholder: 'Enter user ID',
              },
            },
          },
        },
      },
      viewer: {
        title: 'Viewer regions',
        description: 'Control how labels are positioned for regions detected in a photo.',
        fields: {
          'region-label-placement': {
            title: 'Region label placement',
            description:
              'Edge keeps the label attached to the region corner; Floating centers it above the region and moves it below when needed.',
          },
        },
      },
      map: {
        title: 'Map display',
        description: 'Configure providers, style, and projection for the map component.',
        fields: {
          providers: {
            title: 'Map providers',
            description: 'Choose the engines available to the map component.',
            helper: 'Turn off every provider to disable map features.',
          },
          style: {
            title: 'Map style',
            description: 'Provide a MapLibre Style URL or use "builtin" for presets.',
            helper: 'Example: builtin or https://tiles.example.com/style.json',
          },
          projection: {
            title: 'Map projection',
            description: 'Choose the rendering projection.',
            helper: 'Mercator is flat; Globe presents the world as a sphere.',
            placeholder: 'Select a projection',
          },
        },
      },
    },
  },
  system: {
    title: 'Platform Settings',
    description: 'Manage registration flow, login strategy, and shared OAuth providers for the platform.',
    sections: {
      registration: {
        title: 'Global registration policy',
        description: 'Control new user quotas and local account capabilities.',
        fields: {
          'allow-registration': {
            title: 'Allow new registrations',
            description: 'When disabled, only super admins can add accounts manually.',
          },
          'local-provider': {
            title: 'Enable email/password login',
            description: 'When disabled, users must sign in through third-party providers.',
          },
          'max-users': {
            title: 'Maximum registrable users',
            description: 'Block new sign-ups when the limit is reached. Leave empty for unlimited.',
            helper: 'Set to 0 to immediately prevent new registrations.',
            placeholder: 'Unlimited',
          },
        },
      },
      oauth: {
        title: 'OAuth providers',
        description: 'Configure third-party login providers for the site.',
        fields: {
          gateway: {
            title: 'OAuth gateway URL',
            description:
              'Unified callback endpoint for third-party logins (e.g., https://auth.example.com). Leave blank to fall back to the site domain.',
            helper: 'Must include http/https; no trailing slash required.',
            placeholder: 'https://auth.example.com',
          },
        },
        groups: {
          google: {
            title: 'Google OAuth',
            description: 'Create an OAuth app in Google Cloud Console and fill the credentials below.',
            fields: {
              'client-id': {
                title: 'Client ID',
                description: 'Google OAuth client ID.',
                placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com',
              },
              'client-secret': {
                title: 'Client Secret',
                description: 'Google OAuth client secret.',
                placeholder: '************',
              },
            },
          },
          github: {
            title: 'GitHub OAuth',
            description: 'Create an OAuth App under GitHub Developer settings and fill the credentials below.',
            fields: {
              'client-id': {
                title: 'Client ID',
                description: 'GitHub OAuth client ID.',
                placeholder: 'Iv1.xxxxxxxxxxxxxxxx',
              },
              'client-secret': {
                title: 'Client Secret',
                description: 'GitHub OAuth client secret.',
                placeholder: '****************',
              },
            },
          },
          apple: {
            title: 'Sign in with Apple',
            description:
              'Configure the non-secret Apple identifiers here. APPLE_PRIVATE_KEY remains a deployment secret.',
            fields: {
              'web-client-id': {
                title: 'Services ID',
                description: 'Apple Services ID used by the dashboard web login. Apple sign-in is disabled when blank.',
                placeholder: 'art.afilmory.web',
              },
              'team-id': {
                title: 'Team ID',
                description: 'Apple Developer team identifier used to sign client-secret JWTs.',
                placeholder: 'KAMM5N88X3',
              },
              'key-id': {
                title: 'Key ID',
                description: 'Identifier of the Sign in with Apple private key configured in deployment secrets.',
                placeholder: 'ABC123DEFG',
              },
            },
          },
        },
      },
    },
  },
  storage: {
    providers: {
      types: {
        s3: 'AWS S3 Compatible Object Storage',
        github: 'GitHub repository',
        b2: 'Backblaze B2 cloud storage',
        cos: 'Tencent Cloud COS',
        oss: 'Aliyun OSS',
      },
      fields: {
        s3: {
          'bucket': {
            label: 'Bucket name',
            description: 'Name of the S3 bucket that stores your photos.',
            placeholder: 'afilmory-photos',
          },
          'region': {
            label: 'Region',
            description: 'S3 region code, e.g. ap-southeast-1.',
            placeholder: 'ap-southeast-1',
          },
          'endpoint': {
            label: 'Custom endpoint',
            description: 'Optional endpoint for S3-compatible services.',
            placeholder: 'https://s3.example.com',
            helper: 'Leave empty for AWS S3. Required for MinIO or other vendors.',
          },
          'access-key': {
            label: 'Access Key ID',
            placeholder: 'AKIAxxxxxxxxxxxx',
          },
          'secret-key': {
            label: 'Secret Access Key',
            placeholder: '************',
          },
          'prefix': {
            label: 'Path prefix',
            description: 'Optional. Limit scanning to objects under this prefix.',
            placeholder: 'photos/',
          },
          'custom-domain': {
            label: 'Custom public domain',
            description: 'Domain used when generating public photo URLs.',
            placeholder: 'https://cdn.example.com',
          },
          'exclude-regex': {
            label: 'Exclude pattern (regex)',
            description: 'Optional. Skip files that match this regular expression.',
            placeholder: '\\.(tmp|bak)$',
            helper: 'Use JavaScript-compatible regular expressions.',
          },
          'max-files': {
            label: 'Max files',
            description: 'Optional limit for how many files to scan per run.',
            placeholder: '1000',
          },
        },
        github: {
          'owner': {
            label: 'Repository owner',
            description: 'GitHub user or organization name.',
            placeholder: 'afilmory',
          },
          'repo': {
            label: 'Repository name',
            description: 'Repository that stores your photos.',
            placeholder: 'photo-assets',
          },
          'branch': {
            label: 'Branch',
            description: 'Optional branch to sync.',
            placeholder: 'main',
            helper: 'Defaults to master/main. Provide the full branch name if it differs.',
          },
          'token': {
            label: 'Access token',
            description: 'Personal Access Token for private repositories.',
            placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
          },
          'path': {
            label: 'Repository path',
            description: 'Optional path within the repository to limit syncing.',
            placeholder: 'public/photos',
          },
          'custom-domain': {
            label: 'Custom CDN domain',
            description: 'CDN or proxy domain used when generating public URLs.',
            placeholder: 'cdn.jsdelivr.net/gh/owner/repo@branch',
            helper: 'Leave empty to keep raw.githubusercontent.com URLs.',
          },
          'use-raw': {
            label: 'Use raw URL',
            description: 'Use raw.githubusercontent.com when generating public URLs.',
            placeholder: 'true / false',
            helper: 'Set to false if you serve files via a custom domain.',
          },
        },
        b2: {
          'application-key-id': {
            label: 'Application Key ID',
            description: 'Backblaze B2 application key ID used for API authentication.',
            placeholder: '003xxxxxxxxxxxxxxxx000000000',
          },
          'application-key': {
            label: 'Application Key',
            description: 'Secret application key paired with the ID above.',
            placeholder: 'K0000000000000000000000000000000',
          },
          'bucket-id': {
            label: 'Bucket ID',
            description: 'Unique ID of the bucket used for photo storage.',
            placeholder: '4a48fe8875c6214145260818',
          },
          'bucket-name': {
            label: 'Bucket name',
            description: 'Friendly bucket name for reference or public URL generation.',
            placeholder: 'afilmory-photos',
          },
          'prefix': {
            label: 'Path prefix',
            description: 'Optional. Restrict scanning to files under this prefix.',
            placeholder: 'photos/',
          },
          'custom-domain': {
            label: 'Custom public domain',
            description: 'Domain used when generating public URLs (e.g., CDN).',
            placeholder: 'https://cdn.example.com',
          },
          'exclude-regex': {
            label: 'Exclude pattern (regex)',
            description: 'Optional regular expression to skip matching files.',
            placeholder: '\\.(tmp|bak)$',
            helper: 'Use JavaScript-compatible regular expressions.',
          },
          'max-files': {
            label: 'Max files',
            description: 'Optional limit for how many files to scan per run.',
            placeholder: '1000',
          },
          'authorization-ttl': {
            label: 'Authorization TTL (ms)',
            description: 'Override cache duration for B2 authorization tokens.',
            placeholder: '3600000',
          },
          'upload-ttl': {
            label: 'Upload URL TTL (ms)',
            description: 'Override cache duration for B2 upload URLs.',
            placeholder: '900000',
          },
        },
      },
    },
  },
} as const

export default enUiSchema
