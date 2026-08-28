import multiprocessing

# Reserve 2 cores for the OS/event loop where there's headroom to do so, but
# never go below 1 — on a host/container with 2 or fewer visible CPUs,
# `cpu_count() - 2` reaches 0 or negative, and CPU_COUNT is passed straight
# into `ThreadPoolExecutor(max_workers=CPU_COUNT)` (see
# toolbox/access/read_mgr.py), which raises `ValueError: max_workers must be
# greater than 0` the first time a batch-read endpoint runs.
CPU_COUNT = max(1, multiprocessing.cpu_count() - 2)


SUMMARY = """A Toolbox designed to automate the routine tasks of the State Data Analysts (SDA)"""


DESC = """
A web-based application with different utility toolsets to carry out basic and routine analyst tasks.
There are currently 5 main thematic modules each having its own set of applications
These include:<br>
<ol>
 <li><strong>MLoS Module:</strong>Tasks and Operations aimed at the working with master list of settlements</li>
  <ol type='a'>
   <li><b><i>Standardization:</i></b> Clean up your MLoS with capitalization, abbreviation and entry standardization
    including population and takeoff naming standardization</li>
   <li><b><i>Validation/QC:</i></b> Run broad-spectrum QC checks on your MLoS including consistency checks</li>
   <li><b><i>Update:</i></b> Update your MLoS with Updated Validation Data</li>
   <li><b><i>Fixes:</i></b> Address Issues like shift coordinates with proximity issues, populate takeoff points for
    wards with only one takeoff</li>
  </ol><br>

  <li><b>Tracking Module:</b> Conduct Settlement Visitation tracking based on different strategies</li>
   <ol type='a'>
    <li><b><i>Buffer-based Tracking:</i></b> Tracking of settlements using the buffer strategy</li>
    <li><b><i>Gridded Extent based Tracking:</i></b> Use of the Gridded voronoi settlement extent for H2H settlement visitation and coverage analysis</li>
    <li><b><i>REACH Analysis:</i></b> Triangulate Settlement Visitation across multiple campaign data sources</li>
   </ol> <br>

  <li><b>Compiler Module:</b> Combines/disaggregates Settlements list</li>
   <ol type='a'</li>
    <li><b><i>Combine DMP files:</i></b> Extracts and Compiles all zipped Planfeld DMP Files into a single Excel document while maintaining the ward level structure</li>
    <li><b><i>Combine Tracks:</i></b> Combines files into a single SQLite DB File</li>
    <li><b><i>Combine LGA Data:</i></b> Compiles all LGA level validation/desk review settlement list into a single table</li>
    <li><b><i>Disaggregate MLoS:</i></b> Breaks down the MLoS into different administrative level (LGA or Ward) Excel sheets</li>
  </ol> <br>

  <li><b>Reporting Module:</b> Generates Visitation Report from Campaign tracking</li>
   <ol type='a'>
    <li><b><i>Daily Reports:</i></b> Generates Daily Visitation reports based on campaign day and cumulative status</li>
    <li><b><i>Post Implementation Report:</i></b> Generates all post implementation report charts</li>
   </ol>  <br>

  <li><b>TA Module:</b> Generate Target Area Settlement Extent</li>
   <ol type='a'>
    <li><b><i>Generate Gridded TA:</i></b> Generate Gridded Target area settlement extent</li>
   </ol>

</ol>
"""

