# **SDA Toolbox**
This toolbox is a suite of data analysis automation toolsets for EOC data analyst to 
validate MLoS and support campaign through tracking. 

Toolbox Include tools for:
1. MLoS QC and Standardization
2. Campaign Tracking (H2H and Hit and Run)
3. Compiler Tools for Disaggregating and Merging Datasets
4. Microplan Toolsets
5. Fix Spatial proximity issues with settlements and populate takeoff and global id
6. REACH Analysis for Intra and Inter Campaign settlement visitation triangulation
7. Generating Daily and Post Implementation Report
8. EHA GUID Checker
9. Generating Target Area (Voronoi and Gridded TA)


The application has a frontend component with dashboard capability of rendered results which are also downloadable 


## Getting Started
### Prerequisites
- Docker
- Git


### Installation
1. Clone the repository
```bash
    git clone <repository-url>
```

2. Navigate to the repo and create the environment file
```bash
    cd path/to/local/repo
    ./scripts/secrets.sh
 ```

The values in `.env` are credentials for an existing database, so they cannot be
generated — the script creates the file and lists what is still to fill in. The stack
starts without them; database features stay inert until they are set.

3. Set up your virtual environment
```bash
    uv sync
```

4. Build the docker image and start the services
```bash
    docker compose up --build
```

## Project Structure
- `src\frontend`: React Application
- `src\toolbox`: FastAPI Application



**Authors**
---------------------------------------------------------------
Name: <b>Enyinnaya Richard Nwaiwu<b> (Lead Developer)<br>
Name: <b>Muhammad Abubakar Mbawaya<b> (Developer)
