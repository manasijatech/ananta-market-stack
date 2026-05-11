Build a community that brings together traders and developers, both online and offline, to collaborate, experiment, and create.
Open-source a core layer of the platform so anyone can build, customize, and use it for personal or internal workflows. On top of this foundation, offer paid applications, packaged solutions, and enterprise-grade implementations.
Position the product as a modular intelligence platform—private by design, extensible in architecture, and effective in real-world usage. A fully modular system enables two parallel offerings:
Self-hosted, customizable deployments
Fully managed SaaS for teams that want zero operational overhead
Address a key challenge early: seamless updates across all customer environments, whether self-hosted or managed.
Go beyond shipping code. Deliver high-quality documentation, setup guides, and best practices so users can onboard quickly and continuously improve their systems.
Monetization layers:
Applications: Pulse, Myuki (including Optrack)
Managed services: hosted, scalable deployments
Implementation & maintenance: custom setups, integrations, and long-term support for the core platform 

ANALOGY

You want a spot in the AI Land? We will give you a house or commercial building with a strong foundation and metered utilities that you can start using. You just have to bring the land, and decide what your house should look like. 

Oh, and I can rent you a flat as well. And we can connect you to the right experts to make your home better.

Flat - cloud saas for research automations
House - self hosted for personal use personal
Commercial building - done for you self hosting for larger trading firms
Foundation - open source connections, configurations, workflows, audit frameworks
Metered utilities - APIs
Experts - MCP tools
Land - Server VM with static IP


---

Open questions
announcement ingestion API call / message passing
how to get it installed? Set it up?
which market data connectors to package into OS package
what goes into our configurations system
which local dbs?
Docker setup or not to start with?
what are the extension points?
announcements getting redistributed?
which tools to expose? MCP server?
free usage limits for announcements api
What functionality works only with a static ip
Which license to open source under
Multiple broker account connections and position syncing
Optrack - how to deploy it on their server while it being closed source. Docker build?
Broker accounts - log in required everyday for data access?
How to convert repos to open source? - fresh repo with branch protection
Should teams/RBAC be billed / licensed?

Technical choices

Seeding prompts for announcement pipelines -> basically not as part of the codebase
agents.md files everywhere
Docker build package for optrack + myuki voice query
Engineering
Redo and simplify frontend with new auth
Monorepo setup in next.js
Branding
Naming for core open source module
Manasija website with all offerings




---

Chat controls - model, system prompts, enable / disable tools
Multiple instances



Myuki - 
	3 capabilities
		Voice news alerting - customizable
		Trading and risk intelligence assistant
		Voice query
		

OS Components
Alpha alerts UI - 


Workflows
Concall high growth guidance
Concall scouting alert - notification anytime a particular condition match is found
Concall - risk alert - company guiding significantly negative business headwinds
Announcement - Large order win
Announcement - any kind of disruption / discontinuity of business operation
Announcement - key management change - CEO, CFO, Wholetime director, promoter
News - important news with price reacting to it
Identify stocks in play for the day based on news, announcements, key events
Announcement - notification for key events/meets intimated by company
Bring together your own live news feed using claude skills and pass it for further use

Connectors
Broker APIs with auto renew (mutli-account setup)
Redbox
GDFL fundamental data
Gdrive / one drive for internal docs
Non-broker price feeds
Notification channels - WA, slack, teams, telegram, discord


Benefits of self hosted not seen in cloud saas model
	Your positions and query patterns will be visible
	We will know what alerts you are receiving and may train on it
	We get to know what workflows you are running
	We bear the LLM costs and hence the intelligence level we provide you will be lower
	Some important data sources are not available in cloud saas


Benefits of keeping a cloud saas offering
	People can quickly try it out, no hassle
	We get data to train on
	The cloud saas becomes the internal reference implementation 
		Can be used for demos as well as training the services arm



---


Broker Integration
Out of major broker APIs, only Kite requires a webUI login that cannot be automated
Other Brokers also have expiring access tokens but provide a procedure to automate token refresh



Roadmap

OS - Broker connections - price, symbols, positions - copy openalgo @shaun
OS - Price based trading strategy builder - copy openalgo @royston
OS - Rebuild of Alpha Alerts 4 pages + configuration, connections @deion
OS - Environment setup @shaun
API layer - Billing and credits top up system @deion
API layer - Websocket based subscription of new data available in our APIs - based on categories, symbols @deion @jnanesh
OS - Basic chat wrapper on top of our MCP server @Jnanesh
API layer - chat tools MCP @jnanesh
OS - New tools for broker data @shaun
OS - connectors @everyone
OS : Workflows library
OS : Usage tracking / telemetry
OS: Guides for everything
OS: RBAC, broker to user configurations



Frontend in next, backend in fast api, 
mongo - workflow definitions, outputs
Sqlite - configs, telemetry, usage tracking
redis - price data, symbols, 



---


